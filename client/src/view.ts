import type { Html, HtmlBuilder } from "foldkit/html";
import type { SessionEntry } from "../../src/protocol";
import { Message } from "./message";
import type { Model } from "./model";

type H = HtmlBuilder<Message>;

const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

const ncCommand = (model: Model): string =>
	`(printf '%s\\n${model.session}\\n{"type":"prompt","message":"What is 2+2?"}\\n' ${shellQuote(model.token)}; sleep 20) | nc ${model.tcpHost}`;

const bubble = (h: H, entry: SessionEntry): Html => {
	if (entry.kind !== "user") {
		return h.li([h.Key(String(entry.id)), h.Class("self-start max-w-[80%] rounded-2xl bg-white px-4 py-2 ring-1 ring-zinc-200")], [entry.text]);
	}
	const terminal = entry.via === "tcp";
	return h.li([h.Key(String(entry.id)), h.Class("self-end max-w-[80%] text-right")], [
		h.div([h.Class("mb-1 text-xs text-zinc-400")], [terminal ? "terminal" : "browser"]),
		h.div([h.Class(`rounded-2xl px-4 py-2 text-white ${terminal ? "bg-orange-500 font-mono text-sm" : "bg-sky-600"}`)], [entry.text]),
	]);
};

export const view = (model: Model, h: H): Html =>
	h.main([h.Class("mx-auto flex h-dvh max-w-2xl flex-col gap-6 p-6")], [
		h.h1([h.Class("text-3xl font-black tracking-tight")], ["Type here or in a terminal."]),
		h.pre([h.Class("select-all overflow-x-auto rounded-xl bg-zinc-900 p-4 font-mono text-xs text-zinc-100")], [ncCommand(model)]),
		h.ul(
			[h.Class("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto")],
			model.entries.map((entry) => bubble(h, entry)),
		),
		...(model.busyVia === null ? [] : [h.p([h.Class("animate-pulse text-sm text-zinc-400")], ["thinking…"])]),
		h.form([h.Class("flex gap-2"), h.OnSubmit(Message.SubmittedPrompt())], [
			h.input([
				h.Class("flex-1 rounded-xl px-4 py-3 ring-1 ring-zinc-300 focus:outline-none focus:ring-2 focus:ring-sky-500"),
				h.Placeholder(model.link === "open" ? "Ask something" : "Connecting…"),
				h.Value(model.draft),
				h.Disabled(model.link !== "open"),
				h.OnInput((value) => Message.EditedDraft({ value })),
			]),
		]),
	]);
