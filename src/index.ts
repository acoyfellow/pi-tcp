import { sameSecret, validSessionName } from "./auth";
import { byteReader, LineReader } from "./lines";
import type { ByteReader } from "./lines";

export { PiSession } from "./agent";

const SOCKET_OPTIONS: SocketOptions = { allowHalfOpen: true, secureTransport: "off" };
const encoder = new TextEncoder();
const SOCKET_ROUTE = /^\/ws\/([^/]+)$/;

async function refuse(socket: Socket, reason: string): Promise<void> {
	const writer = socket.writable.getWriter();
	await writer.write(encoder.encode(`${JSON.stringify({ type: "refused", reason })}\n`)).catch(() => undefined);
	await Promise.allSettled([socket.close()]);
}

function remainingBytes(lines: LineReader, reader: ByteReader): ReadableStream<Uint8Array> {
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

async function nextLine(lines: LineReader): Promise<string> {
	const line = await lines.next().catch(() => undefined);
	return (line ?? "").trim();
}

async function handleTcp(socket: Socket, env: Env): Promise<void> {
	const reader = byteReader(socket.readable);
	const lines = new LineReader(reader);
	if (!sameSecret(await nextLine(lines), env.PI_TCP_TOKEN)) {
		return refuse(socket, "bad token");
	}
	const name = await nextLine(lines);
	if (!validSessionName(name)) {
		return refuse(socket, "session name must match [a-z0-9-]{1,63}");
	}
	const upstream = env.PI_SESSION.getByName(name).connect("pi-session:0", SOCKET_OPTIONS);
	const upstreamSink: WritableStream<unknown> = upstream.writable;
	try {
		await upstream.opened;
		await Promise.all([remainingBytes(lines, reader).pipeTo(upstreamSink), upstream.readable.pipeTo(socket.writable)]);
	} finally {
		await Promise.allSettled([socket.close(), upstream.close()]);
	}
}

function handleWebSocket(request: Request, env: Env, name: string): Promise<Response> | Response {
	const token = new URL(request.url).searchParams.get("token") ?? "";
	if (!sameSecret(token, env.PI_TCP_TOKEN)) {
		return new Response("bad token", { status: 401 });
	}
	if (!validSessionName(name)) {
		return new Response("bad session name", { status: 400 });
	}
	return env.PI_SESSION.getByName(name).fetch(request);
}

export default {
	connect: handleTcp,
	fetch(request, env) {
		const route = SOCKET_ROUTE.exec(new URL(request.url).pathname);
		if (route?.[1] !== undefined) {
			return handleWebSocket(request, env, route[1]);
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
