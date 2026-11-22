import { DurableObject } from "cloudflare:workers";

const PI_PORT = 7000;
const BOX_NAME = "default";
const READY_ATTEMPTS = 100;
const READY_HOLD_MS = 1000;
const SOCKET_OPTIONS: SocketOptions = { allowHalfOpen: true, secureTransport: "off" };

async function pipeBothWays(client: Socket, upstream: Socket): Promise<void> {
	try {
		await Promise.all([
			client.readable.pipeTo(upstream.writable),
			upstream.readable.pipeTo(client.writable),
		]);
	} finally {
		await Promise.allSettled([client.close(), upstream.close()]);
	}
}

async function staysOpen(candidate: Socket): Promise<boolean> {
	await candidate.opened;
	const closedEarly = await Promise.race([
		candidate.closed.then(() => true, () => true),
		scheduler.wait(READY_HOLD_MS).then(() => false),
	]);
	return !closedEarly;
}

async function openReadySocket(container: Container, port: number): Promise<Socket> {
	for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt++) {
		const candidate = container.getTcpPort(port).connect(`10.0.0.1:${port}`, SOCKET_OPTIONS);
		const ready = await staysOpen(candidate).catch(() => false);
		if (ready) return candidate;
		await Promise.allSettled([candidate.close()]);
		await scheduler.wait(READY_HOLD_MS);
	}
	throw new Error(`container port ${port} did not become ready`);
}

export class PiBox extends DurableObject<Env> {
	async connect(socket: Socket): Promise<void> {
		const container = this.ctx.container!;
		if (!container.running) container.start({ enableInternet: false });
		const upstream = await openReadySocket(container, PI_PORT);
		await pipeBothWays(socket, upstream);
	}
}

function constantTimeEqual(left: string, right: string): boolean {
	const a = new TextEncoder().encode(left);
	const b = new TextEncoder().encode(right);
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
	return difference === 0;
}

async function readFirstLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ line: string; rest: Uint8Array }> {
	const decoder = new TextDecoder();
	let buffered = new Uint8Array(0);
	while (buffered.length < 1024) {
		const newline = buffered.indexOf(10);
		if (newline >= 0) {
			return { line: decoder.decode(buffered.subarray(0, newline)).trim(), rest: buffered.subarray(newline + 1) };
		}
		const { value, done } = await reader.read();
		if (done) break;
		const merged = new Uint8Array(buffered.length + value.length);
		merged.set(buffered);
		merged.set(value, buffered.length);
		buffered = merged;
	}
	throw new Error("missing token line");
}

async function authenticatedStream(socket: Socket, token: string): Promise<ReadableStream<Uint8Array>> {
	const reader = socket.readable.getReader();
	const { line, rest } = await readFirstLine(reader);
	if (!token || !constantTimeEqual(line, token)) throw new Error("bad token");
	return new ReadableStream<Uint8Array>({
		start(controller) {
			if (rest.length) controller.enqueue(rest);
		},
		async pull(controller) {
			const { value, done } = await reader.read();
			if (done) controller.close();
			else controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
}

function openBox(env: Env): Socket {
	return env.PI_BOX.getByName(BOX_NAME).connect(`pi-box:${PI_PORT}`, SOCKET_OPTIONS);
}

export default {
	async connect(socket, env) {
		const clientBytes = await authenticatedStream(socket, env.PI_TCP_TOKEN).catch(async () => {
			await Promise.allSettled([socket.close()]);
			return null;
		});
		if (!clientBytes) return;
		const upstream = openBox(env);
		await upstream.opened;
		try {
			await Promise.all([clientBytes.pipeTo(upstream.writable), upstream.readable.pipeTo(socket.writable)]);
		} finally {
			await Promise.allSettled([socket.close(), upstream.close()]);
		}
	},
} satisfies ExportedHandler<Env>;
