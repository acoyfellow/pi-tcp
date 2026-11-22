import { writeFile } from "node:fs/promises";
import net from "node:net";

const TOKEN = process.env.PI_TCP_TOKEN ?? "dev-token";
const HTTP = process.env.PI_TCP_HTTP ?? "http://localhost:8791";
const TCP_HOST = process.env.PI_TCP_HOST ?? "127.0.0.1";
const TCP_PORT = Number(process.env.PI_TCP_PORT ?? "7000");
const TURN_TIMEOUT_MS = 90_000;
const session = `proof-${Date.now().toString(36)}`;

const CLAIM =
	"One Pi Durable session takes turns from raw TCP and from a browser at the same time; each side sees the other's turns; a reconnect on either side loses no turns.";

function frameBuffer() {
	const frames = [];
	const waiters = [];
	return {
		frames,
		push(frame) {
			frames.push(frame);
			for (const waiter of waiters.slice()) {
				if (waiter.test(frame)) {
					waiters.splice(waiters.indexOf(waiter), 1);
					waiter.resolve(frame);
				}
			}
		},
		next(test) {
			const seen = frames.find(test);
			if (seen) {
				frames.splice(frames.indexOf(seen), 1);
				return Promise.resolve(seen);
			}
			return new Promise((resolve, reject) => {
				const waiter = {
					test,
					resolve: (frame) => {
						clearTimeout(timer);
						frames.splice(frames.indexOf(frame), 1);
						resolve(frame);
					},
				};
				const timer = setTimeout(() => reject(new Error(`timed out waiting for frame in ${session}`)), TURN_TIMEOUT_MS);
				waiters.push(waiter);
			});
		},
	};
}

function openTcp() {
	const buffer = frameBuffer();
	const socket = net.connect(TCP_PORT, TCP_HOST);
	let pending = "";
	socket.setEncoding("utf8");
	socket.on("data", (chunk) => {
		pending += chunk;
		for (let index = pending.indexOf("\n"); index >= 0; index = pending.indexOf("\n")) {
			const line = pending.slice(0, index).trim();
			pending = pending.slice(index + 1);
			if (line) {
				buffer.push(JSON.parse(line));
			}
		}
	});
	socket.write(`${TOKEN}\n${session}\n`);
	return {
		buffer,
		send: (command) => socket.write(`${JSON.stringify(command)}\n`),
		close: () =>
			new Promise((resolve) => {
				socket.end(resolve);
			}),
	};
}

async function openWeb() {
	const buffer = frameBuffer();
	const url = `${HTTP.replace(/^http/, "ws")}/ws/${session}?token=${encodeURIComponent(TOKEN)}`;
	const socket = new WebSocket(url);
	socket.addEventListener("message", (event) => buffer.push(JSON.parse(String(event.data))));
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("websocket failed")), { once: true });
	});
	return {
		buffer,
		send: (command) => socket.send(JSON.stringify(command)),
		close: () => {
			socket.close();
			return Promise.resolve();
		},
	};
}

const isType = (type) => (frame) => frame.type === type;
const isEntry = (kind) => (frame) => frame.type === "entry" && frame.entry.kind === kind;
const isResponseTo = (id) => (frame) => frame.type === "response" && frame.id === id;

async function turn(asker, watcher, message) {
	asker.send({ type: "prompt", message });
	const askerUser = await asker.buffer.next(isEntry("user"));
	const watcherUser = await watcher.buffer.next(isEntry("user"));
	const askerAssistant = await asker.buffer.next(isEntry("assistant"));
	const watcherAssistant = await watcher.buffer.next(isEntry("assistant"));
	await asker.buffer.next(isType("agent_settled"));
	await watcher.buffer.next(isType("agent_settled"));
	return { askerUser: askerUser.entry, watcherUser: watcherUser.entry, askerAssistant: askerAssistant.entry, watcherAssistant: watcherAssistant.entry };
}

async function replay(client, id, after) {
	client.send({ type: "replay", id, after });
	const response = await client.buffer.next(isResponseTo(id));
	return response.entries ?? [];
}

const checks = [];
function check(name, passed, detail) {
	checks.push({ name, passed, detail });
	process.stdout.write(`${passed ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}\n`);
}

const startedAt = new Date().toISOString();
const started = performance.now();
let failure;

try {
	const badWebOpened = await new Promise((resolve) => {
		const socket = new WebSocket(`${HTTP.replace(/^http/, "ws")}/ws/${session}?token=wrong`);
		socket.addEventListener("open", () => {
			socket.close();
			resolve(true);
		});
		socket.addEventListener("error", () => resolve(false));
	});
	check("browser socket with a bad token is refused", !badWebOpened, badWebOpened ? "opened" : "handshake rejected");

	const tcp = openTcp();
	const web = await openWeb();
	await tcp.buffer.next(isType("ready"));
	await web.buffer.next(isType("ready"));
	const peers = await web.buffer.next((frame) => frame.type === "peers" && frame.tcp === 1 && frame.web === 1);
	check("both transports join one session", peers.tcp === 1 && peers.web === 1, `${peers.tcp} tcp, ${peers.web} web`);

	const fromTcp = await turn(tcp, web, "Reply with exactly: ack tcp");
	check("browser sees a turn asked over TCP", fromTcp.watcherUser.id === fromTcp.askerUser.id && fromTcp.watcherUser.via === "tcp", `entry #${fromTcp.watcherUser.id} via ${fromTcp.watcherUser.via}`);
	check("browser sees the reply to the TCP turn", fromTcp.watcherAssistant.text === fromTcp.askerAssistant.text, JSON.stringify(fromTcp.watcherAssistant.text));

	const fromWeb = await turn(web, tcp, "Reply with exactly: ack web");
	check("TCP sees a turn asked from the browser", fromWeb.watcherUser.id === fromWeb.askerUser.id && fromWeb.watcherUser.via === "web", `entry #${fromWeb.watcherUser.id} via ${fromWeb.watcherUser.via}`);
	check("TCP sees the reply to the browser turn", fromWeb.watcherAssistant.text === fromWeb.askerAssistant.text, JSON.stringify(fromWeb.watcherAssistant.text));

	const tcpLastSeen = fromWeb.watcherAssistant.id;
	await tcp.close();
	web.send({ type: "prompt", message: "Reply with exactly: while tcp was away" });
	await web.buffer.next(isType("agent_settled"));
	const tcpBack = openTcp();
	await tcpBack.buffer.next(isType("ready"));
	const tcpMissed = await replay(tcpBack, "tcp-replay", tcpLastSeen);
	check(
		"TCP reconnect replays the turn it missed",
		tcpMissed.some((entry) => entry.kind === "user" && entry.via === "web") && tcpMissed.some((entry) => entry.kind === "assistant"),
		`${tcpMissed.length} entries after #${tcpLastSeen}`,
	);

	const webLastSeen = tcpMissed.at(-1)?.id ?? tcpLastSeen;
	await web.close();
	tcpBack.send({ type: "prompt", message: "Reply with exactly: while web was away" });
	await tcpBack.buffer.next(isType("agent_settled"));
	const webBack = await openWeb();
	await webBack.buffer.next(isType("ready"));
	const webMissed = await replay(webBack, "web-replay", webLastSeen);
	check(
		"browser reconnect replays the turn it missed",
		webMissed.some((entry) => entry.kind === "user" && entry.via === "tcp") && webMissed.some((entry) => entry.kind === "assistant"),
		`${webMissed.length} entries after #${webLastSeen}`,
	);

	webBack.send({ type: "get_messages", id: "all" });
	const all = (await webBack.buffer.next(isResponseTo("all"))).entries ?? [];
	const ids = all.map((entry) => entry.id);
	check("history is ordered with no duplicates", ids.every((id, index) => index === 0 || id > ids[index - 1]), `${ids.length} entries`);
	check("history holds all four user turns", all.filter((entry) => entry.kind === "user").length === 4, all.filter((entry) => entry.kind === "user").map((entry) => entry.via).join(","));

	await tcpBack.close();
	await webBack.close();
} catch (error) {
	failure = error instanceof Error ? error.message : String(error);
	check("proof ran to the end", false, failure);
}

const passed = failure === undefined && checks.every((entry) => entry.passed);
const elapsedSeconds = Math.round((performance.now() - started) / 100) / 10;
const date = startedAt.slice(0, 10);
const receiptPath = `receipts/proof-${date}.md`;
const status = {
	claim: CLAIM,
	state: passed ? "proven" : "unproven",
	scope: "local wrangler dev, Workers AI binding (remote)",
	checkedAt: startedAt,
	session,
	receipt: receiptPath,
	checks,
};

const receipt = [
	`# Proof: ${date}`,
	"",
	`Claim: ${CLAIM}`,
	"",
	`Result: **${status.state}** in ${elapsedSeconds}s against ${HTTP} and ${TCP_HOST}:${TCP_PORT}. Session \`${session}\`.`,
	"",
	"| Check | Result | Detail |",
	"|---|---|---|",
	...checks.map((entry) => `| ${entry.name} | ${entry.passed ? "pass" : "FAIL"} | ${(entry.detail ?? "").replaceAll("|", String.raw`\|`)} |`),
	"",
	"Reproduce: `npm run dev` in one terminal, `npm run proof` in another.",
	"",
].join("\n");

await writeFile(receiptPath, receipt);
await writeFile("status.json", `${JSON.stringify(status, null, "\t")}\n`);
process.stdout.write(`\n${status.state}: wrote ${receiptPath} and status.json\n`);
process.exit(passed ? 0 : 1);
