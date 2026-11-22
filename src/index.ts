import { sameSecret, validSessionName } from "./auth";
import { LineReader } from "./lines";

export { PiSession } from "./agent";

const SOCKET_OPTIONS: SocketOptions = { allowHalfOpen: true, secureTransport: "off" };
const encoder = new TextEncoder();

async function refuse(socket: Socket, reason: string): Promise<void> {
	const writer = socket.writable.getWriter();
	await writer.write(encoder.encode(`${JSON.stringify({ type: "refused", reason })}\n`)).catch(() => undefined);
	await Promise.allSettled([socket.close()]);
}

function remainingBytes(lines: LineReader, reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			for (let line = await lines.next(); line !== undefined; line = await lines.next()) {
				controller.enqueue(encoder.encode(`${line}\n`));
			}
			controller.close();
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
}

export default {
	async connect(socket, env) {
		const reader = socket.readable.getReader();
		const lines = new LineReader(reader);
		const token = (await lines.next().catch(() => undefined)) ?? "";
		if (!sameSecret(token.trim(), env.PI_TCP_TOKEN)) return refuse(socket, "bad token");
		const name = ((await lines.next().catch(() => undefined)) ?? "").trim();
		if (!validSessionName(name)) return refuse(socket, "session name must match [a-z0-9-]{1,63}");

		const upstream = env.PI_SESSION.getByName(name).connect("pi-session:0", SOCKET_OPTIONS);
		try {
			await upstream.opened;
			await Promise.all([
				remainingBytes(lines, reader).pipeTo(upstream.writable),
				upstream.readable.pipeTo(socket.writable),
			]);
		} finally {
			await Promise.allSettled([socket.close(), upstream.close()]);
		}
	},
} satisfies ExportedHandler<Env>;
