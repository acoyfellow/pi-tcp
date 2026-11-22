import { Duration, Effect, Schema } from "effect";
import { Command, Dom } from "foldkit";
import { Message } from "./message";

const COPY_FEEDBACK = Duration.seconds(2);

export const CopyText = Command.define("CopyText", {
	args: { text: Schema.String },
	messages: [Message.CopiedCommand, Message.FailedCopy],
	execute: ({ text }) =>
		Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
			Effect.as(Message.CopiedCommand()),
			Effect.orElseSucceed(() => Message.FailedCopy()),
		),
});

export const ResetCopyLater = Command.define("ResetCopyLater", {
	args: {},
	messages: [Message.ResetCopy],
	execute: () => Effect.sleep(COPY_FEEDBACK).pipe(Effect.as(Message.ResetCopy())),
});

export const LATEST_TURN_ID = "latest-turn";

export const ScrollToLatest = Command.define("ScrollToLatest", {
	args: {},
	messages: [Message.ScrolledToLatest],
	execute: () =>
		Dom.scrollIntoViewAfterPaint(`#${LATEST_TURN_ID}`, { block: "end" }).pipe(
			Effect.ignore,
			Effect.as(Message.ScrolledToLatest()),
		),
});
