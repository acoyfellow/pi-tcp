#!/usr/bin/env node
import net from "node:net";
import readline from "node:readline";

const [hostPort = "127.0.0.1:7000", session = "demo"] = process.argv.slice(2);
const [host, port = "7000"] = hostPort.split(":");
const token = process.env.PI_TCP_TOKEN;
const out = (line) => process.stdout.write(`${line}\n`);
const fail = (line) => {
	process.stderr.write(`${line}\n`);
	process.exit(1);
};

if (!token) {
	fail("set PI_TCP_TOKEN");
}

const socket = net.connect(Number(port), host);
socket.write(`${token}\n${session}\n${JSON.stringify({ id: "history", type: "get_messages" })}\n`);

const label = (entry) => {
	const who = entry.kind === "user" ? "you" : "pi";
	return entry.via ? `${who} (${entry.via})` : who;
};

const print = (entry) => {
	if (entry.text) {
		out(`${label(entry)}: ${entry.text}`);
	}
};

const handlers = {
	refused: (frame) => fail(`refused: ${frame.reason}`),
	ready: (frame) => out(`connected to ${frame.session}`),
	peers: (frame) => out(`· ${frame.tcp} nc, ${frame.web} web connected`),
	busy: (frame) => out(`· pi is thinking (asked via ${frame.via})`),
	entry: (frame) => print(frame.entry),
	response: (frame) => {
		for (const entry of frame.entries ?? []) {
			print(entry);
		}
		if (frame.error) {
			out(`error: ${frame.error}`);
		}
	},
	agent_settled: () => process.stdout.write("> "),
};

let buffered = "";
socket.on("data", (chunk) => {
	buffered += chunk.toString("utf8");
	for (let newline = buffered.indexOf("\n"); newline >= 0; newline = buffered.indexOf("\n")) {
		const frame = JSON.parse(buffered.slice(0, newline));
		buffered = buffered.slice(newline + 1);
		handlers[frame.type]?.(frame);
	}
});
socket.on("close", () => process.exit(0));

const input = readline.createInterface({ input: process.stdin });
process.stdout.write("> ");
let next = 0;
input.on("line", (message) => {
	if (message.trim()) {
		next += 1;
		socket.write(`${JSON.stringify({ id: String(next), type: "prompt", message })}\n`);
	}
});
input.on("close", () => socket.end());
