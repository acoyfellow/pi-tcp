import type { Html, HtmlBuilder } from "foldkit/html";
import type { SessionEntry, Transport } from "../../src/protocol";
import { Message } from "./message";
import type { Link, Model } from "./model";

type H = HtmlBuilder<Message>;

const REPO = "https://github.com/acoyfellow/pi-tcp";

const LINK_LABEL: Record<Link, string> = {
	connecting: "connecting",
	open: "live",
	closed: "not connected",
	refused: "refused",
};

const LINK_DOT: Record<Link, string> = {
	connecting: "bg-amber-400 animate-pulse",
	open: "bg-emerald-500",
	closed: "bg-zinc-400",
	refused: "bg-red-500",
};

const TRANSPORT_BADGE: Record<Transport, string> = {
	tcp: "bg-orange-100 text-orange-800 ring-orange-300",
	web: "bg-sky-100 text-sky-800 ring-sky-300",
};

const badge = (h: H, via: Transport): Html =>
	h.span([h.Class(`ml-2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ring-1 ${TRANSPORT_BADGE[via]}`)], [via === "tcp" ? "nc" : "web"]);

const entryRow = (h: H, entry: SessionEntry): Html => {
	const mine = entry.kind === "user";
	return h.li([h.Key(String(entry.id)), h.Class(`flex ${mine ? "justify-end" : "justify-start"}`)], [
		h.div([h.Class(`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${mine ? "bg-zinc-900 text-white" : "bg-white ring-1 ring-zinc-200"}`)], [
			h.div([h.Class("mb-1 flex items-center text-[11px] opacity-60")], [
				h.span([], [mine ? "you" : "pi"]),
				...(entry.via === undefined ? [] : [badge(h, entry.via)]),
				h.span([h.Class("ml-auto pl-3 font-mono")], [`#${entry.id}`]),
			]),
			h.p([h.Class("whitespace-pre-wrap")], [entry.text]),
		]),
	]);
};

const statusBar = (h: H, model: Model): Html =>
	h.div([h.Class("flex flex-wrap items-center gap-3 text-xs text-zinc-600")], [
		h.span([h.Class("flex items-center gap-1.5")], [
			h.span([h.Class(`inline-block h-2 w-2 rounded-full ${LINK_DOT[model.link]}`)], []),
			LINK_LABEL[model.link],
		]),
		h.span([h.Class("font-mono")], [`session ${model.session}`]),
		h.span([], [`${model.tcpPeers} nc · ${model.webPeers} web connected`]),
		...(model.busyVia === null ? [] : [h.span([h.Class("animate-pulse text-amber-700")], [`pi is thinking (asked via ${model.busyVia === "tcp" ? "nc" : "web"})`])]),
	]);

const chat = (h: H, model: Model): Html =>
	h.section([h.Class("flex min-h-0 flex-1 flex-col rounded-2xl bg-zinc-50 ring-1 ring-zinc-200")], [
		h.div([h.Class("border-b border-zinc-200 px-4 py-3")], [statusBar(h, model)]),
		h.ul(
			[h.Class("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4")],
			model.entries.length === 0
				? [h.li([h.Class("m-auto text-sm text-zinc-400")], ["No turns yet. Ask from here or from nc."])]
				: model.entries.map((entry) => entryRow(h, entry)),
		),
		h.form([h.Class("flex gap-2 border-t border-zinc-200 p-3"), h.OnSubmit(Message.SubmittedPrompt())], [
			h.input([
				h.Class("flex-1 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-zinc-300 focus:outline-none focus:ring-2 focus:ring-orange-400"),
				h.Placeholder(model.link === "open" ? "Ask pi something" : "Connect first"),
				h.Value(model.draft),
				h.Disabled(model.link !== "open"),
				h.OnInput((value) => Message.EditedDraft({ value })),
			]),
			h.button([
				h.Type("submit"),
				h.Class("rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40"),
				h.Disabled(model.link !== "open" || model.draft.trim().length === 0),
			], ["Send"]),
		]),
	]);

const ncCommand = (model: Model): string =>
	`(printf '%s\\n${model.session}\\n{"type":"prompt","message":"hello from nc"}\\n' "$PI_TCP_TOKEN"; sleep 30) | nc ${model.tcpHost}`;

const field = (h: H, label: string, value: string, onInput: (value: string) => Message, type = "text"): Html =>
	h.label([h.Class("block text-xs font-medium text-zinc-600")], [
		label,
		h.input([
			h.Class("mt-1 w-full rounded-lg bg-white px-2 py-1.5 font-mono text-sm ring-1 ring-zinc-300 focus:outline-none focus:ring-2 focus:ring-orange-400"),
			h.Type(type),
			h.Value(value),
			h.OnInput(onInput),
		]),
	]);

const sidePanel = (h: H, model: Model): Html =>
	h.aside([h.Class("flex w-full flex-col gap-4 md:w-96")], [
		h.div([h.Class("rounded-2xl bg-white p-4 ring-1 ring-zinc-200")], [
			h.h2([h.Class("mb-3 text-sm font-semibold")], ["1. Connect the browser"]),
			h.div([h.Class("flex flex-col gap-3")], [
				field(h, "Token", model.token, (value) => Message.EditedToken({ value }), "password"),
				field(h, "Session", model.session, (value) => Message.EditedSession({ value })),
				h.button([
					h.Class("rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40"),
					h.Disabled(model.token.length === 0),
					h.OnClick(Message.ClickedConnect()),
				], [model.link === "open" ? "Reconnect" : "Connect"]),
			]),
		]),
		h.div([h.Class("rounded-2xl bg-zinc-900 p-4 text-zinc-100")], [
			h.h2([h.Class("mb-2 text-sm font-semibold")], ["2. Talk to the same session over raw TCP"]),
			h.p([h.Class("mb-3 text-xs text-zinc-400")], ["Run this in a terminal. The turn shows up here with an nc badge."]),
			h.pre([h.Class("overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed")], [ncCommand(model)]),
		]),
		h.div([h.Class("rounded-2xl bg-white p-4 text-xs leading-relaxed text-zinc-600 ring-1 ring-zinc-200")], [
			h.p([], ["One Durable Object holds the session. The Worker's connect() handler takes nc. Its fetch() handler takes this page's WebSocket. Both feed the same Pi Durable harness."]),
			h.p([h.Class("mt-2")], [
				"Proof only: one shared token, no TLS on the TCP side. ",
				h.a([h.Href(REPO), h.Class("underline hover:text-zinc-900")], ["Source"]),
			]),
		]),
	]);

export const view = (model: Model, h: H): Html =>
	h.main([h.Class("mx-auto flex h-dvh max-w-6xl flex-col gap-4 p-4 md:p-6")], [
		h.header([h.Class("flex items-baseline gap-3")], [
			h.h1([h.Class("text-2xl font-black tracking-tight")], ["pi-tcp"]),
			h.p([h.Class("text-sm text-zinc-500")], ["one durable Pi session, two transports"]),
		]),
		h.div([h.Class("flex min-h-0 flex-1 flex-col gap-4 md:flex-row")], [chat(h, model), sidePanel(h, model)]),
	]);
