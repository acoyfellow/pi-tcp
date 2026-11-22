const NEWLINE = 10;
const MAX_LINE_BYTES = 64 * 1024;

export class LineReader {
	private buffered = new Uint8Array(0);
	private readonly decoder = new TextDecoder();

	constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

	async next(): Promise<string | undefined> {
		for (;;) {
			const newline = this.buffered.indexOf(NEWLINE);
			if (newline >= 0) {
				const line = this.decoder.decode(this.buffered.subarray(0, newline)).replace(/\r$/, "");
				this.buffered = this.buffered.slice(newline + 1);
				return line;
			}
			if (this.buffered.length > MAX_LINE_BYTES) throw new Error("line too long");
			const { value, done } = await this.reader.read();
			if (done) return undefined;
			const merged = new Uint8Array(this.buffered.length + value.length);
			merged.set(this.buffered);
			merged.set(value, this.buffered.length);
			this.buffered = merged;
		}
	}
}

export class LineWriter {
	private readonly encoder = new TextEncoder();
	private chain: Promise<void> = Promise.resolve();

	constructor(private readonly writer: WritableStreamDefaultWriter<Uint8Array>) {}

	send(record: unknown): Promise<void> {
		const bytes = this.encoder.encode(`${JSON.stringify(record)}\n`);
		this.chain = this.chain.then(() => this.writer.write(bytes));
		return this.chain;
	}
}
