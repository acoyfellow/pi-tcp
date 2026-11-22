const NEWLINE = 10;
const MAX_LINE_BYTES = 64 * 1024;

export type ByteReader = ReadableStreamDefaultReader<Uint8Array>;

function isBytes(value: unknown): value is Uint8Array {
	return Object.prototype.toString.call(value) === "[object Uint8Array]";
}

export function byteReader(stream: ReadableStream<unknown>): ByteReader {
	const reader = stream.getReader();
	const read = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
		const result = await reader.read();
		if (result.done) {
			return { done: true, value: undefined };
		}
		if (!isBytes(result.value)) {
			throw new TypeError("socket produced a non-byte chunk");
		}
		return { done: false, value: result.value };
	};
	return {
		read,
		cancel: (reason) => reader.cancel(reason),
		releaseLock: () => reader.releaseLock(),
		closed: reader.closed,
	};
}

export class LineReader {
	private buffered = new Uint8Array(0);
	private readonly decoder = new TextDecoder();

	constructor(private readonly reader: ByteReader) {}

	async next(): Promise<string | undefined> {
		for (;;) {
			const newline = this.buffered.indexOf(NEWLINE);
			if (newline >= 0) {
				const line = this.decoder.decode(this.buffered.subarray(0, newline)).replace(/\r$/, "");
				this.buffered = this.buffered.slice(newline + 1);
				return line;
			}
			if (this.buffered.length > MAX_LINE_BYTES) {
				throw new Error("line too long");
			}
			const { value, done } = await this.reader.read();
			if (done) {
				return undefined;
			}
			const merged = new Uint8Array(this.buffered.length + value.length);
			merged.set(this.buffered);
			merged.set(value, this.buffered.length);
			this.buffered = merged;
		}
	}
}

export class LineWriter {
	private readonly encoder = new TextEncoder();
	private readonly writer: WritableStreamDefaultWriter<unknown>;
	private chain: Promise<void> = Promise.resolve();

	constructor(stream: WritableStream<unknown>) {
		this.writer = stream.getWriter();
	}

	send(record: unknown): Promise<void> {
		const bytes = this.encoder.encode(`${JSON.stringify(record)}\n`);
		this.chain = this.chain.then(() => this.writer.write(bytes));
		return this.chain;
	}
}
