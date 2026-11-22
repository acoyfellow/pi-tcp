import { Duration, Effect, Option, Queue, Schema, Stream } from "effect";
import type { Cause } from "effect";
import { Command, ManagedResource, Subscription } from "foldkit";
import { ServerFrameJson, socketPath } from "../../src/protocol";
import type { ServerFrame } from "../../src/protocol";
import { Message } from "./message";
import type { Model } from "./model";

const CONNECT_TIMEOUT = Duration.seconds(5);
const MAX_BACKOFF = Duration.seconds(10);
export const GIVE_UP_AFTER = 6;

type FrameQueue = Queue.Queue<ServerFrame, Cause.Done>;

type Connection = { readonly socket: WebSocket; readonly frames: FrameQueue };

export const PiSocket = ManagedResource.tag<Connection>()("PiSocket");

export type PiSocketService = ManagedResource.ServiceOf<typeof PiSocket>;

const Target = Schema.Struct({ session: Schema.String, token: Schema.String, epoch: Schema.Number });

const decodeFrame = Schema.decodeUnknownOption(ServerFrameJson);

class SocketFailed extends Schema.TaggedError<SocketFailed>()("SocketFailed", { reason: Schema.String }) {}

const reconnectDelay = (attempt: number): Duration.Duration =>
	attempt <= 1 ? Duration.zero : Duration.min(Duration.millis(250 * 2 ** Math.min(attempt, 6)), MAX_BACKOFF);

const socketUrl = (session: string, token: string): string => {
	const scheme = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
	return `${scheme}//${globalThis.location.host}${socketPath(session)}?token=${encodeURIComponent(token)}`;
};

const bufferFrames = (socket: WebSocket, frames: FrameQueue): void => {
	socket.addEventListener("message", (event: MessageEvent<unknown>) => {
		Option.map(decodeFrame(event.data), (frame) => Queue.offerUnsafe(frames, frame));
	});
	socket.addEventListener("close", () => Queue.endUnsafe(frames), { once: true });
};

const connect = (session: string, token: string, frames: FrameQueue) =>
	Effect.callback<WebSocket, SocketFailed>((resume) => {
		const socket = new WebSocket(socketUrl(session, token));
		const failed = () => resume(Effect.fail(new SocketFailed({ reason: "could not connect" })));
		const opened = () => {
			socket.removeEventListener("close", failed);
			resume(Effect.succeed(socket));
		};
		bufferFrames(socket, frames);
		socket.addEventListener("open", opened, { once: true });
		socket.addEventListener("close", failed, { once: true });
		return Effect.sync(() => {
			socket.removeEventListener("open", opened);
			socket.removeEventListener("close", failed);
			socket.close();
		});
	}).pipe(
		Effect.timeout(CONNECT_TIMEOUT),
		Effect.catchTag("TimeoutError", () => Effect.fail(new SocketFailed({ reason: "timed out" }))),
	);

const open = (session: string, token: string, epoch: number) =>
	Effect.gen(function* () {
		yield* Effect.sleep(reconnectDelay(epoch));
		const frames = yield* Queue.unbounded<ServerFrame, Cause.Done>();
		const socket = yield* connect(session, token, frames);
		return { socket, frames };
	});

const wantsSocket = (model: Model): boolean =>
	model.token.length > 0 && model.link !== "refused" && model.failures < GIVE_UP_AFTER;

export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
	piSocket: entry(Schema.Option(Target), {
		resource: PiSocket,
		modelToMaybeRequirements: (model) =>
			wantsSocket(model)
				? Option.some({ session: model.session, token: model.token, epoch: model.epoch })
				: Option.none(),
		acquire: ({ session, token, epoch }) => open(session, token, epoch),
		release: ({ socket }) => Effect.sync(() => socket.close()),
		onAcquired: () => Message.SocketOpened(),
		onReleased: () => Message.SocketClosed(),
		onAcquireError: () => Message.SocketClosed(),
	}),
}));

const framesOf = ({ frames }: Connection): Stream.Stream<Message> =>
	Stream.fromQueue(frames).pipe(
		Stream.map((frame) => Message.ReceivedFrame({ frame })),
		Stream.concat(Stream.succeed(Message.SocketClosed())),
	);

export const subscriptions = Subscription.make<Model, Message, PiSocketService>()((entry) => ({
	frames: entry(
		{ open: Schema.Boolean, epoch: Schema.Number },
		{
			modelToDependencies: (model) => ({ open: model.link === "open", epoch: model.epoch }),
			dependenciesToStream: ({ open: isOpen }) =>
				isOpen
					? Stream.unwrap(
							PiSocket.get.pipe(
								Effect.map(framesOf),
								Effect.catchTag("ResourceNotAvailable", () => Effect.succeed(Stream.empty)),
							),
						)
					: Stream.empty,
		},
	),
}));

const sendJson = (record: unknown) =>
	PiSocket.get.pipe(Effect.flatMap(({ socket }) => Effect.sync(() => socket.send(JSON.stringify(record)))));

export const SendPrompt = Command.define("SendPrompt", {
	args: { message: Schema.String },
	messages: [Message.SentPrompt, Message.FailedSend],
	execute: ({ message }) =>
		sendJson({ type: "prompt", message }).pipe(
			Effect.as(Message.SentPrompt()),
			Effect.orElseSucceed(() => Message.FailedSend()),
		),
});

export const LoadHistory = Command.define("LoadHistory", {
	args: {},
	messages: [Message.SentPrompt, Message.FailedSend],
	execute: () =>
		sendJson({ type: "get_messages", id: "history" }).pipe(
			Effect.as(Message.SentPrompt()),
			Effect.orElseSucceed(() => Message.FailedSend()),
		),
});
