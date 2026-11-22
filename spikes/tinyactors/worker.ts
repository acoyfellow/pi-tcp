import { DurableObject } from "cloudflare:workers";
import { compileCharts, Host, init, SimulatedClock } from "@tinyactors/wasm/init";
import wasm from "@tinyactors/wasm/tinyactors.wasm";
import roomChart from "../../src/charts/room.scxml";

const POSTS = 25;

function speakerFor(index: number): { from: string; next: string } {
	return index % 2 === 0 ? { from: "a", next: "b" } : { from: "b", next: "a" };
}

export class Room extends DurableObject {
	override async fetch(): Promise<Response> {
		const started = Date.now();
		await init(wasm);
		const compiled = compileCharts([{ name: "room.scxml", text: roomChart }], { warningsAsErrors: true });
		const events: Array<string> = [];
		const host = new Host(compiled, {
			system: "pi-tcp",
			datamodel: "quickjs",
			clock: new SimulatedClock(),
			ioProcessors: { "room:bus": { receive: (send) => void events.push(String(send.event)) } },
		});
		compiled.close();
		const room = host.spawn("room");
		room.send("post", { from: "human", human: true, text: "start", next: "a" });
		room.send("post", { from: "b", text: "out of turn" });
		for (let index = 0; index < POSTS; index += 1) {
			room.send("post", { ...speakerFor(index), text: `t${index}` });
		}
		await host.idle();
		host.close();
		return Response.json({
			ms: Date.now() - started,
			turns: events.filter((event) => event === "turn").length,
			rejected: events.filter((event) => event === "rejected").length,
			closed: events.includes("closed"),
		});
	}
}

export default {
	fetch: (_request: Request, env: { ROOM: DurableObjectNamespace<Room> }) => env.ROOM.getByName("spike").fetch("http://spike/"),
};
