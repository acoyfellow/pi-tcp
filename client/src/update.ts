import type { Update } from "foldkit";
import { modifyFields } from "foldkit/struct";
import type { ServerFrame, SessionEntry } from "../../src/protocol";
import { Message } from "./message";
import type { Model } from "./model";
import { LoadHistory, SendPrompt } from "./socket";
import type { PiSocketService } from "./socket";

type Return = Update.Return<Model, Message, PiSocketService>;

const only = (model: Model): Return => ({ model, commands: [] });

const mergeEntries = (current: ReadonlyArray<SessionEntry>, incoming: ReadonlyArray<SessionEntry>): ReadonlyArray<SessionEntry> => {
	const byId = new Map(current.map((entry) => [entry.id, entry]));
	for (const entry of incoming) {
		byId.set(entry.id, entry);
	}
	return [...byId.values()].toSorted((left, right) => left.id - right.id);
};

const applyFrame = (model: Model, frame: ServerFrame): Model => {
	switch (frame.type) {
		case "entry": {
			return modifyFields(model, { entries: (entries) => mergeEntries(entries, [frame.entry]) });
		}
		case "response": {
			return frame.entries === undefined ? model : modifyFields(model, { entries: (entries) => mergeEntries(entries, frame.entries ?? []) });
		}
		case "peers": {
			return modifyFields(model, { tcpPeers: () => frame.tcp, webPeers: () => frame.web });
		}
		case "busy": {
			return modifyFields(model, { busyVia: () => frame.via });
		}
		case "agent_settled": {
			return modifyFields(model, { busyVia: () => null });
		}
		case "ready": {
			return model;
		}
	}
};

export const update = (model: Model, message: Message): Return =>
	Message.match(message, {
		EditedDraft: ({ value }) => only(modifyFields(model, { draft: () => value })),
		EditedToken: ({ value }) => only(modifyFields(model, { token: () => value.trim(), link: () => "closed" })),
		EditedSession: ({ value }) => only(modifyFields(model, { session: () => value.trim().toLowerCase(), entries: () => [], link: () => "closed" })),
		ClickedConnect: () =>
			only(modifyFields(model, { link: () => "connecting", failures: () => 0, epoch: (epoch) => epoch + 1 })),
		SubmittedPrompt: () => {
			const text = model.draft.trim();
			if (text.length === 0 || model.link !== "open") {
				return only(model);
			}
			return { model: modifyFields(model, { draft: () => "" }), commands: [SendPrompt({ message: text })] };
		},
		SocketOpened: () => ({ model: modifyFields(model, { link: () => "open", failures: () => 0 }), commands: [LoadHistory({})] }),
		SocketClosed: () =>
			only(
				model.link === "open"
					? modifyFields(model, { link: () => "connecting", epoch: (epoch) => epoch + 1 })
					: modifyFields(model, { failures: (failures) => failures + 1, epoch: (epoch) => epoch + 1 }),
			),
		ReceivedFrame: ({ frame }) => only(applyFrame(model, frame)),
		SentPrompt: () => only(model),
		FailedSend: () => only(modifyFields(model, { link: () => "connecting", epoch: (epoch) => epoch + 1 })),
	});
