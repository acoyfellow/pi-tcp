import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import type { Conversation, EntryId, EntryRecord, Wake } from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import { DurableObject } from "cloudflare:workers";
import { LineReader, LineWriter } from "./lines";
import { MODEL_ID, workersAiBindingProvider } from "./model";

const INSTRUCTIONS = "You are pi, an agent in a Cloudflare Durable Object reached over raw TCP. Be concise.";
const HEARTBEAT_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PROMPT_CHARS = 4000;

type ConnectionState = { lastSeen: EntryId | undefined };

type Command = { readonly id?: string; readonly type?: string; readonly message?: string; readonly after?: number };

interface Session {
	readonly harness: Harness;
	readonly conversation: Conversation;
}

type ContentBlock = { readonly type: string; readonly text?: string };

function blocksOf(content: unknown): readonly ContentBlock[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

function textOf(entry: EntryRecord): string {
	return (entry.model ?? [])
		.flatMap((message) => blocksOf(message.content))
		.map((block) => (block.type === "text" ? (block.text ?? "") : ""))
		.join("");
}

function summarize(entry: EntryRecord) {
	return { id: entry.id, kind: entry.kind, text: textOf(entry) };
}

export class PiSession extends DurableObject<Env> {
	private session: Promise<Session> | undefined;

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
		if (at === undefined) await this.ctx.storage.deleteAlarm();
		else await this.ctx.storage.setAlarm(at);
	}

	async alarm(): Promise<void> {
		const { harness } = await this.open();
		await this.arm({ ...harness.wake(), active: true });
		harness.resume();
		await this.arm(harness.wake());
	}

	private async entriesAfter(lastSeen: EntryId | undefined): Promise<EntryRecord[]> {
		const { conversation } = await this.open();
		const query = lastSeen === undefined ? { order: "ascending" as const } : { order: "ascending" as const, minEntryId: (lastSeen + 1) as EntryId };
		const entries: EntryRecord[] = [];
		let cursor;
		do {
			const page = await conversation.entries(query, PAGE_SIZE, cursor, BACKGROUND_CONTEXT);
			entries.push(...page.items);
			cursor = page.items.length ? page.next : undefined;
		} while (cursor);
		return entries;
	}

	private async sendEntriesAfter(out: LineWriter, state: ConnectionState, lastSeen: EntryId | undefined): Promise<void> {
		for (const entry of await this.entriesAfter(lastSeen)) {
			await out.send({ type: "entry", entry: summarize(entry) });
			state.lastSeen = entry.id;
		}
	}

	private async handle(command: Command, out: LineWriter, state: ConnectionState): Promise<void> {
		const reply = (data: unknown, success = true, error?: string) =>
			out.send({ id: command.id, type: "response", command: command.type, success, ...(error ? { error } : { data }) });

		if (command.type === "get_messages") {
			const entries = await this.entriesAfter(undefined);
			state.lastSeen = entries.at(-1)?.id ?? state.lastSeen;
			return reply({ entries: entries.map(summarize) });
		}
		if (command.type === "replay") {
			await reply({});
			state.lastSeen = command.after as EntryId | undefined;
			return this.sendEntriesAfter(out, state, state.lastSeen);
		}
		if (command.type === "abort") {
			const { conversation } = await this.open();
			await conversation.abort(BACKGROUND_CONTEXT, {});
			return reply({});
		}
		if (command.type === "prompt") {
			const message = (command.message ?? "").slice(0, MAX_PROMPT_CHARS);
			if (!message) return reply(undefined, false, "message is required");
			const { harness, conversation } = await this.open();
			await this.arm({ ...harness.wake(), active: true });
			const submission = await conversation.submit({ type: "input", content: message, whenBusy: "followUp" }, BACKGROUND_CONTEXT);
			await reply({ disposition: "started", submissionId: submission.id });
			await submission.wait(BACKGROUND_CONTEXT);
			await this.sendEntriesAfter(out, state, state.lastSeen);
			return void (await out.send({ type: "agent_settled" }));
		}
		return reply(undefined, false, `unknown command: ${command.type}`);
	}

	async connect(socket: Socket): Promise<void> {
		const lines = new LineReader(socket.readable.getReader());
		const out = new LineWriter(socket.writable.getWriter());
		const state: ConnectionState = { lastSeen: undefined };
		await out.send({ type: "ready", session: this.ctx.id.name ?? null });
		try {
			for (let line = await lines.next(); line !== undefined; line = await lines.next()) {
				if (!line.trim()) continue;
				let command: Command;
				try {
					command = JSON.parse(line) as Command;
				} catch {
					await out.send({ type: "response", success: false, error: "invalid JSON" });
					continue;
				}
				await this.handle(command, out, state);
			}
		} finally {
			await Promise.allSettled([socket.close()]);
		}
	}
}
