#!/usr/bin/env node
import net from "node:net";
import readline from "node:readline";

const [hostPort = "127.0.0.1:7000", session = "default"] = process.argv.slice(2);
const [host, port] = hostPort.split(":");
const token = process.env.PI_TCP_TOKEN;
if (!token) {
	console.error("set PI_TCP_TOKEN");
	process.exit(1);
}

const socket = net.connect(Number(port ?? 7000), host);
socket.write(`${token}\n${session}\n${JSON.stringify({ id: "history", type: "get_messages" })}\n`);

let buffered = "";
socket.on("data", (chunk) => {
	buffered += chunk.toString("utf8");
	for (let newline = buffered.indexOf("\n"); newline >= 0; newline = buffered.indexOf("\n")) {
		const record = JSON.parse(buffered.slice(0, newline));
		buffered = buffered.slice(newline + 1);
		if (record.type === "refused") console.error(`refused: ${record.reason}`);
		if (record.command === "get_messages") for (const entry of record.data.entries) print(entry);
		if (record.type === "entry" && record.entry.kind !== "pi.user") print(record.entry);
		if (record.type === "agent_settled") process.stdout.write("> ");
	}
});
socket.on("close", () => process.exit(0));

function print(entry) {
	if (!entry.text) return;
	const who = entry.kind === "pi.user" ? "you" : "pi";
	console.log(`${who}: ${entry.text}`);
}

const input = readline.createInterface({ input: process.stdin });
process.stdout.write("> ");
let next = 0;
input.on("line", (message) => {
	if (message.trim()) socket.write(`${JSON.stringify({ id: String(++next), type: "prompt", message })}\n`);
});
input.on("close", () => socket.end());
