import { Schema } from "effect";

export const Transport = Schema.Literals(["tcp", "web"]);
export type Transport = typeof Transport.Type;

export const EntryKind = Schema.Literals(["user", "assistant", "other"]);
export type EntryKind = typeof EntryKind.Type;

export const SessionEntry = Schema.Struct({
	id: Schema.Number,
	kind: EntryKind,
	text: Schema.String,
	via: Schema.optional(Transport),
});
export type SessionEntry = typeof SessionEntry.Type;

export const ClientCommand = Schema.Union([
	Schema.Struct({ type: Schema.Literal("prompt"), id: Schema.optional(Schema.String), message: Schema.String }),
	Schema.Struct({ type: Schema.Literal("get_messages"), id: Schema.optional(Schema.String) }),
	Schema.Struct({ type: Schema.Literal("replay"), id: Schema.optional(Schema.String), after: Schema.optional(Schema.Number) }),
	Schema.Struct({ type: Schema.Literal("abort"), id: Schema.optional(Schema.String) }),
]);
export type ClientCommand = typeof ClientCommand.Type;

export const ClientCommandJson = Schema.fromJsonString(ClientCommand);

export const ServerFrame = Schema.Union([
	Schema.Struct({ type: Schema.Literal("ready"), session: Schema.String, peers: Schema.Number }),
	Schema.Struct({ type: Schema.Literal("peers"), tcp: Schema.Number, web: Schema.Number }),
	Schema.Struct({ type: Schema.Literal("entry"), entry: SessionEntry }),
	Schema.Struct({ type: Schema.Literal("busy"), via: Transport }),
	Schema.Struct({ type: Schema.Literal("agent_settled") }),
	Schema.Struct({
		type: Schema.Literal("response"),
		id: Schema.optional(Schema.String),
		command: Schema.String,
		success: Schema.Boolean,
		error: Schema.optional(Schema.String),
		entries: Schema.optional(Schema.Array(SessionEntry)),
	}),
]);
export type ServerFrame = typeof ServerFrame.Type;

export const ServerFrameJson = Schema.fromJsonString(ServerFrame);

export const SESSION_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const socketPath = (session: string): string => `/ws/${session}`;
