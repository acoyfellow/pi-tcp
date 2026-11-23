import { readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";

const HOST = process.env.PI_TCP_HOST ?? "pi-tcp.abs-staging.cloudflarestorage.com";
const PORT = Number(process.env.PI_TCP_PORT ?? "7000");
const TOKEN = process.env.PI_TCP_TOKEN ?? (await readFile(`${homedir()}/.config/pi-tcp/kitchen-token`, "utf8")).trim();
const REPLY_TIMEOUT_MS = 60_000;
const CLAIM = "Over the public internet, a Spectrum app with a Worker origin carries raw TCP to the PiSession Durable Object: a bad token is refused, a prompt is answered, and a second TCP peer on the same session sees the turn and the reply.";

const session = `public-${Date.now().toString(36)}`;
const startedAt = new Date().toISOString();
const checks = [];
const check = (name, passed, detail) => {
	checks.push({ name, passed, detail });
	process.stdout.write(`${passed ? "PASS" : "FAIL"} ${name}: ${detail}\n`);
};

const openPeer = (lines) =>
	new Promise((resolve, reject) => {
		const opened = performance.now();
		const socket = connect({ host: HOST, port: PORT });
		const frames = [];
		const waiters = [];
		let buffer = "";
		socket.setEncoding("utf8");
		socket.on("data", (chunk) => {
			buffer += chunk;
			const parts = buffer.split("\n");
			buffer = parts.pop() ?? "";
			for (const text of parts.filter(Boolean)) {
				const frame = { at: performance.now() - opened, ...JSON.parse(text) };
				frames.push(frame);
				for (const waiter of waiters.slice()) {
					if (waiter.match(frame)) {
						waiters.splice(waiters.indexOf(waiter), 1);
						waiter.resolve(frame);
					}
				}
			}
		});
		socket.on("error", reject);
		socket.on("connect", () => {
			socket.write(`${lines.join("\n")}\n`);
			resolve({
				socket,
				frames,
				send: (value) => socket.write(`${JSON.stringify(value)}\n`),
				next: (match) => {
					const seen = frames.find(match);
					if (seen) {
						return Promise.resolve(seen);
					}
					return new Promise((done, fail) => {
						waiters.push({ match, resolve: done });
						setTimeout(() => fail(new Error("timed out waiting for a frame")), REPLY_TIMEOUT_MS);
					});
				},
			});
		});
	});

const isEntry = (kind) => (frame) => frame.type === "entry" && frame.entry.kind === kind;

let failure;
try {
	const intruder = await openPeer(["not-the-token", session]);
	const refusal = await intruder.next((frame) => frame.type === "refused");
	check("a bad token is refused", refusal.reason === "bad token", JSON.stringify(refusal.reason));
	intruder.socket.destroy();

	const asker = await openPeer([TOKEN, session]);
	const ready = await asker.next((frame) => frame.type === "ready");
	check("the token opens a session", ready.session === session, `ready in ${Math.round(ready.at)} ms`);

	const watcher = await openPeer([TOKEN, session]);
	const peers = await watcher.next((frame) => frame.type === "peers" && frame.tcp === 2);
	check("two TCP peers join one session", peers.tcp === 2, `${peers.tcp} tcp`);

	const sentAt = performance.now();
	asker.send({ type: "prompt", message: "Reply with exactly: public tcp ok" });
	const reply = await asker.next(isEntry("assistant"));
	const replyMs = Math.round(performance.now() - sentAt);
	check("the prompt is answered", reply.entry.text.toLowerCase().includes("public tcp ok"), `${JSON.stringify(reply.entry.text)} in ${replyMs} ms`);

	const seenTurn = await watcher.next(isEntry("user"));
	const seenReply = await watcher.next(isEntry("assistant"));
	check("the other peer sees the turn", seenTurn.entry.via === "tcp" && seenReply.entry.id === reply.entry.id, `entry #${seenTurn.entry.id} via ${seenTurn.entry.via}, reply #${seenReply.entry.id}`);

	asker.socket.destroy();
	watcher.socket.destroy();
} catch (error) {
	failure = error instanceof Error ? error.message : String(error);
	check("proof ran to the end", false, failure);
}

const passed = failure === undefined && checks.every((entry) => entry.passed);
const date = startedAt.slice(0, 10);
const receiptPath = `receipts/proof-public-${date}.md`;
const receipt = [
	`# Public proof: ${date}`,
	"",
	`Claim: ${CLAIM}`,
	"",
	`Result: **${passed ? "proven" : "unproven"}** against \`${HOST}:${PORT}\` at ${startedAt}. Session \`${session}\`.`,
	"",
	"| Check | Result | Detail |",
	"|---|---|---|",
	...checks.map((entry) => `| ${entry.name} | ${entry.passed ? "pass" : "FAIL"} | ${String(entry.detail).replaceAll("|", String.raw`\|`)} |`),
	"",
	"Scope: TCP only. The public web page is behind Cloudflare Access, so the browser half is proven locally by `npm run proof`, not here.",
	"",
	"Reproduce: `npm run proof:public` with the token in `PI_TCP_TOKEN` or `~/.config/pi-tcp/kitchen-token`.",
	"",
].join("\n");
await writeFile(receiptPath, receipt);
process.stdout.write(`\n${passed ? "proven" : "unproven"}: wrote ${receiptPath}\n`);
process.exitCode = passed ? 0 : 1;
