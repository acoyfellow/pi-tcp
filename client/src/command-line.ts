import type { Model } from "./model";

const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

export const ncCommand = (model: Model): string =>
	`(printf '%s\\n${model.session}\\n{"type":"prompt","message":"What is 2+2?"}\\n' ${shellQuote(model.token)}; sleep 20) | nc ${model.tcpHost}`;
