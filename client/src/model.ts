import { Schema } from "effect";
import { SessionEntry, Transport } from "../../src/protocol";

export const Link = Schema.Literals(["connecting", "open", "closed", "refused"]);
export type Link = typeof Link.Type;

export const CopyState = Schema.Literals(["idle", "copied", "failed"]);
export type CopyState = typeof CopyState.Type;

export const Model = Schema.Struct({
	session: Schema.String,
	token: Schema.String,
	draft: Schema.String,
	entries: Schema.Array(SessionEntry),
	link: Link,
	epoch: Schema.Number,
	failures: Schema.Number,
	busyVia: Schema.NullOr(Transport),
	tcpPeers: Schema.Number,
	webPeers: Schema.Number,
	tcpHost: Schema.String,
	copy: CopyState,
});
export type Model = typeof Model.Type;
