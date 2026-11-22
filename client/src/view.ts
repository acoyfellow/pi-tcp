import type { Html, HtmlBuilder } from "foldkit/html";
import type { SessionEntry } from "../../src/protocol";
import { LATEST_TURN_ID } from "./clipboard";
import { ncCommand } from "./command-line";
import { Message } from "./message";
import type { CopyState, Link, Model } from "./model";

type H = HtmlBuilder<Message>;

const PROMPT_ID = "prompt";
const PROMPT_HINT_ID = "prompt-hint";
const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-600 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-sky-400 dark:focus-visible:ring-offset-zinc-950";
const MUTED = "text-zinc-600 dark:text-zinc-400";

const LINK_TEXT: Record<Link, string> = {
	connecting: "Connecting",
	open: "Live",
	closed: "Offline",
	refused: "Token refused",
};

const LINK_DOT: Record<Link, string> = {
	connecting: "bg-amber-500 motion-safe:animate-pulse",
	open: "bg-emerald-600",
	closed: "bg-zinc-400",
	refused: "bg-red-600",
};

const COPY_TEXT: Record<CopyState, string> = {
	idle: "Copy",
	copied: "Copied",
	failed: "Select and copy",
};

const statusPill = (h: H, link: Link): Html =>
	h.p(
		[
			h.Role("status"),
			h.Class("flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-1 text-sm text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700"),
		],
		[h.span([h.AriaHidden(true), h.Class(`h-2 w-2 rounded-full ${LINK_DOT[link]}`)], []), LINK_TEXT[link]],
	);

const header = (h: H, model: Model): Html =>
	h.header([h.Class("flex items-start justify-between gap-4")], [
		h.div([], [
			h.h1([h.Class("text-3xl font-black tracking-tight sm:text-4xl")], ["Type here or in a terminal."]),
			h.p([h.Class(`mt-2 ${MUTED}`)], ["Both talk to the same agent, with the same memory."]),
		]),
		statusPill(h, model.link),
	]);

const terminalStep = (h: H, model: Model): Html =>
	h.section([h.AriaLabelledBy("terminal-heading"), h.Class("rounded-2xl bg-zinc-900 p-4 text-zinc-100 ring-1 ring-zinc-900 dark:bg-black dark:ring-zinc-800")], [
		h.div([h.Class("mb-3 flex items-center justify-between gap-3")], [
			h.h2([h.Id("terminal-heading"), h.Class("text-sm font-semibold")], ["Paste this in a terminal"]),
			h.button(
				[
					h.Type("button"),
					h.OnClick(Message.ClickedCopy()),
					h.Class(
						"min-h-9 rounded-lg bg-white/10 px-3 text-sm font-semibold hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900",
					),
				],
				[COPY_TEXT[model.copy]],
			),
		]),
		h.pre([h.Class("whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-zinc-200 select-all")], [h.code([], [ncCommand(model)])]),
		h.p([h.AriaLive("polite"), h.Class("sr-only")], [model.copy === "copied" ? "Command copied" : ""]),
	]);

const userTurn = (h: H, entry: SessionEntry): Html => {
	const terminal = entry.via === "tcp";
	const label = terminal ? "From terminal" : "From browser";
	const labelColor = terminal ? "text-orange-700 dark:text-orange-400" : "text-sky-700 dark:text-sky-400";
	const bubble = terminal ? "bg-orange-700 font-mono text-sm" : "bg-sky-700";
	return h.li([h.Key(String(entry.id)), h.Class("flex flex-col items-end gap-1")], [
		h.span([h.Class(`text-xs font-semibold ${labelColor}`)], [label]),
		h.p([h.Class(`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2 text-white ${bubble}`)], [entry.text]),
	]);
};

const agentTurn = (h: H, entry: SessionEntry): Html =>
	h.li([h.Key(String(entry.id)), h.Class("flex flex-col items-start gap-1")], [
		h.span([h.Class(`text-xs font-semibold ${MUTED}`)], ["Agent"]),
		h.p(
			[
				h.Class(
					"max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-white px-4 py-2 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700",
				),
			],
			[entry.text],
		),
	]);

const turn = (h: H, entry: SessionEntry): Html => (entry.kind === "user" ? userTurn(h, entry) : agentTurn(h, entry));

const emptyState = (h: H): Html =>
	h.div([h.Class(`m-auto max-w-xs text-center ${MUTED}`)], [
		h.p([h.Class("font-semibold text-zinc-800 dark:text-zinc-200")], ["No messages yet"]),
		h.p([h.Class("mt-1 text-sm")], ["Run the command above, or ask something below. Each message shows where it came from."]),
	]);

const messages = (h: H, model: Model): Html =>
	h.div(
		[
			h.Role("log"),
			h.AriaLabel("Messages"),
			h.AriaLive("polite"),
			h.AriaBusy(model.busyVia !== null),
			h.Tabindex(0),
			h.Class(`min-h-0 flex-1 overflow-y-auto rounded-lg ${FOCUS_RING}`),
		],
		[h.ol([h.Class("flex flex-col gap-4")], model.entries.map((entry) => turn(h, entry))), h.div([h.Id(LATEST_TURN_ID), h.AriaHidden(true)], [])],
	);

const thinking = (h: H, model: Model): Html =>
	h.p([h.AriaLive("polite"), h.Class(`min-h-5 text-sm ${MUTED}`)], [
		model.busyVia === null ? "" : `Agent is replying to the ${model.busyVia === "tcp" ? "terminal" : "browser"}…`,
	]);

const conversation = (h: H, model: Model): Html =>
	h.section(
		[h.AriaLabel("Conversation"), h.Class("flex min-h-0 flex-1 flex-col rounded-2xl bg-zinc-100/60 p-4 ring-1 ring-zinc-200 dark:bg-zinc-900/60 dark:ring-zinc-800")],
		[model.entries.length === 0 ? emptyState(h) : messages(h, model)],
	);

const composer = (h: H, model: Model): Html => {
	const ready = model.link === "open";
	const canSend = ready && model.draft.trim().length > 0;
	return h.form([h.OnSubmit(Message.SubmittedPrompt()), h.Class("flex flex-col gap-1")], [
		h.label([h.For(PROMPT_ID), h.Class("sr-only")], ["Message"]),
		h.div([h.Class("flex gap-2")], [
			h.input([
				h.Id(PROMPT_ID),
				h.Type("text"),
				h.Autocomplete("off"),
				h.EnterKeyHint("send"),
				h.AriaDescribedBy(PROMPT_HINT_ID),
				h.Placeholder(ready ? "Ask something" : "Waiting for connection…"),
				h.Value(model.draft),
				h.Readonly(!ready),
				h.OnInput((value) => Message.EditedDraft({ value })),
				h.Class(
					`min-h-12 min-w-0 flex-1 rounded-xl bg-white px-4 text-base ring-1 ring-zinc-400 placeholder:text-zinc-600 read-only:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-600 dark:placeholder:text-zinc-400 dark:read-only:bg-zinc-800 ${FOCUS_RING}`,
				),
			]),
			h.button(
				[
					h.Type("submit"),
					h.Disabled(!canSend),
					h.Class(
						`min-h-12 rounded-xl bg-sky-700 px-5 font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-700 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300 ${FOCUS_RING}`,
					),
				],
				["Send"],
			),
		]),
		h.p([h.Id(PROMPT_HINT_ID), h.Class(`text-xs ${MUTED}`)], [`Press Enter to send. Session ${model.session}.`]),
	]);
};

export const view = (model: Model, h: H): Html =>
	h.main([h.Class("mx-auto flex h-dvh max-w-2xl flex-col gap-5 p-4 sm:p-6")], [
		header(h, model),
		terminalStep(h, model),
		conversation(h, model),
		thinking(h, model),
		composer(h, model),
	]);
