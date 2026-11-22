import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { ServerFrame } from "../../src/protocol";

export const Message = defineMessageUnion({
	EditedDraft: { value: Schema.String },
	EditedToken: { value: Schema.String },
	EditedSession: { value: Schema.String },
	SubmittedPrompt: {},
	ClickedConnect: {},
	SocketOpened: {},
	SocketClosed: {},
	ReceivedFrame: { frame: ServerFrame },
	SentPrompt: {},
	FailedSend: {},
});

export type Message = typeof Message.Type;
