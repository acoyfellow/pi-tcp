import { Option, Schema } from "effect";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import type { Conversation, EntryRecord, Wake } from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import { DurableObject } from "cloudflare:workers";
import { byteReader, LineReader, LineWriter } from "./lines";
import { MODEL_ID, workersAiBindingProvider } from "./model";
import { ClientCommandJson } from "./protocol";
import type { ClientCommand, EntryKind, ServerFrame, SessionEntry, Transport } from "./protocol";

const INSTRUCTIONS = "You are pi, an agent in a Cloudflare Durable Object. People reach you over raw TCP and over a web page at the same time. Be concise.";
const HEARTBEAT_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PROMPT_CHARS = 4000;
const BROADCAST_KEY = "lastBroadcast";

const decodeCommand = Schema.decodeUnknownOption(ClientCommandJson);

type Peer = { readonly via: Transport; send(frame: ServerFrame): Promise<void> };

type ContentBlock = { readonly type: string; readonly text?: string };

interface Session {
	readonly harness: Harness;
	readonly conversation: Conversation;
}

function isContentBlock(value: unknown): value is ContentBlock {
	return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

function blocksOf(content: unknown): ReadonlyArray<ContentBlock> {
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}
	return Array.isArray(content) ? content.filter(isContentBlock) : [];
}

function textOf(entry: EntryRecord): string {
	return (entry.model ?? [])
		.flatMap((message) => blocksOf(message.content))
		.map((block) => (block.type === "text" ? (block.text ?? "") : ""))
		.join("");
}

function kindOf(entry: EntryRecord): EntryKind {
	if (entry.kind === "pi.user") {
		return "user";
	}
	return entry.kind === "pi.assistant" ? "assistant" : "other";
}

export class PiSession extends DurableObject<Env> {
	private session: Promise<Session> | undefined;
	private readonly peers = new Set<Peer>();

	private open(): Promise<Session> {
		this.session ??= this.openHarness();
		return this.session;
	}

	private async openHarness(): Promise<Session> {
		const models = createModels();
		const provider = workersAiBindingProvider(this.env.AI);
		models.setProvider(provider);
		const harness = await Harness.open(
			await openDurableObjectSqliteStorage(this.ctx.storage),
			{ models, registry: createRegistry(), onWake: (wake) => void this.arm(wake) },
			BACKGROUND_CONTEXT,
		);
		const conversation = await harness.root(BACKGROUND_CONTEXT, {
			agent: { model: { provider: provider.id, modelId: MODEL_ID }, instructions: INSTRUCTIONS },
		});
		await this.arm(harness.wake());
		harness.resume();
		return { harness, conversation };
	}

	private async arm(wake: Wake): Promise<void> {
		const heartbeat = wake.active ? Date.now() + HEARTBEAT_MS : undefined;
		const at = heartbeat === undefined || wake.at === undefined ? (heartbeat ?? wake.at) : Math.min(heartbeat, wake.at);
		if (at === undefined) {
			await this.ctx.storage.deleteAlarm();
		} else {
			await this.ctx.storage.setAlarm(at);
		}
	}

	override async alarm(): Promise<void> {
		const { harness } = await this.open();
		await this.arm({ ...harness.wake(), active: true });
		harness.resume();
		await this.arm(harness.wake());
	}

	private toSessionEntry(entry: EntryRecord): SessionEntry {
		const sessionEntry: SessionEntry = { id: entry.id, kind: kindOf(entry), text: textOf(entry) };
		const via = this.ctx.storage.kv.get<Transport>(`via:${entry.id}`);
		return via === undefined ? sessionEntry : { ...sessionEntry, via };
	}

	private async entriesAfter(lastSeen: number | undefined): Promise<Array<SessionEntry>> {
		const { conversation } = await this.open();
		const entries: Array<EntryRecord> = [];
		let cursor;
		do {
			const page = await conversation.entries({ order: "ascending" }, PAGE_SIZE, cursor, BACKGROUND_CONTEXT);
			entries.push(...page.items);
			cursor = page.items.length > 0 ? page.next : undefined;
		} while (cursor);
		return entries.flatMap((entry) => {
			if (lastSeen !== undefined && entry.id <= lastSeen) {
				return [];
			}
			const sessionEntry = this.toSessionEntry(entry);
			return sessionEntry.kind === "other" ? [] : [sessionEntry];
		});
	}

	private async broadcastNewEntries(pendingVia?: Transport): Promise<void> {
		const lastBroadcast = this.ctx.storage.kv.get<number>(BROADCAST_KEY);
		const fresh = await this.entriesAfter(lastBroadcast);
		for (const entry of fresh) {
			const tagged = pendingVia !== undefined && entry.kind === "user" && entry.via === undefined ? this.tag(entry, pendingVia) : entry;
			await this.broadcast({ type: "entry", entry: tagged });
			this.ctx.storage.kv.put(BROADCAST_KEY, entry.id);
		}
	}

	private tag(entry: SessionEntry, via: Transport): SessionEntry {
		this.ctx.storage.kv.put(`via:${entry.id}`, via);
		return { ...entry, via };
	}

	private async broadcast(frame: ServerFrame): Promise<void> {
		await Promise.allSettled([...this.peers].map((peer) => peer.send(frame)));
	}

	private async announcePeers(): Promise<void> {
		const peers = [...this.peers];
		await this.broadcast({
			type: "peers",
			tcp: peers.filter((peer) => peer.via === "tcp").length,
			web: peers.filter((peer) => peer.via === "web").length,
		});
	}

	private async join(peer: Peer): Promise<void> {
		this.peers.add(peer);
		await peer.send({ type: "ready", session: this.ctx.id.name ?? "", peers: this.peers.size });
		await this.announcePeers();
	}

	private async leave(peer: Peer): Promise<void> {
		this.peers.delete(peer);
		await this.announcePeers();
	}

	private async handle(command: ClientCommand, peer: Peer): Promise<void> {
		const respond = (fields: { success: boolean; error?: string; entries?: Array<SessionEntry> }) => {
			const frame: ServerFrame = { type: "response", command: command.type, ...fields };
			return peer.send(command.id === undefined ? frame : { ...frame, id: command.id });
		};

		switch (command.type) {
			case "get_messages": {
				return respond({ success: true, entries: await this.entriesAfter(undefined) });
			}
			case "replay": {
				return respond({ success: true, entries: await this.entriesAfter(command.after) });
			}
			case "abort": {
				const { conversation } = await this.open();
				await conversation.abort(BACKGROUND_CONTEXT, {});
				return respond({ success: true });
			}
			case "prompt": {
				const message = command.message.trim().slice(0, MAX_PROMPT_CHARS);
				if (message.length === 0) {
					return respond({ success: false, error: "message is required" });
				}
				const { harness, conversation } = await this.open();
				await this.arm({ ...harness.wake(), active: true });
				const submission = await conversation.submit({ type: "input", content: message, whenBusy: "followUp" }, BACKGROUND_CONTEXT);
				await respond({ success: true });
				await this.broadcast({ type: "busy", via: peer.via });
				await this.broadcastNewEntries(peer.via);
				await submission.wait(BACKGROUND_CONTEXT);
				await this.broadcastNewEntries();
				return this.broadcast({ type: "agent_settled" });
			}
		}
	}

	private async receive(raw: string, peer: Peer): Promise<void> {
		if (raw.trim().length === 0) {
			return;
		}
		const command = decodeCommand(raw);
		if (Option.isNone(command)) {
			return peer.send({ type: "response", command: "unknown", success: false, error: "invalid command" });
		}
		return this.handle(command.value, peer);
	}

	async connect(socket: Socket): Promise<void> {
		const lines = new LineReader(byteReader(socket.readable));
		const out = new LineWriter(socket.writable);
		const peer: Peer = { via: "tcp", send: (frame) => out.send(frame) };
		await this.join(peer);
		try {
			for (let line = await lines.next(); line !== undefined; line = await lines.next()) {
				await this.receive(line, peer);
			}
		} finally {
			await this.leave(peer);
			await Promise.allSettled([socket.close()]);
		}
	}

	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade") !== "websocket") {
			return new Response("expected websocket", { status: 426 });
		}
		const { 0: client, 1: server } = new WebSocketPair();
		server.accept();
		const peer: Peer = {
			via: "web",
			send: (frame) => {
				server.send(JSON.stringify(frame));
				return Promise.resolve();
			},
		};
		server.addEventListener("message", (event) => {
			if (typeof event.data === "string") {
				this.ctx.waitUntil(this.receive(event.data, peer));
			}
		});
		server.addEventListener("close", () => {
			this.ctx.waitUntil(this.leave(peer));
		});
		await this.join(peer);
		return new Response(null, { status: 101, webSocket: client });
	}
}
