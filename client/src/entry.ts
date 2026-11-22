import { Runtime } from "foldkit";
import { Message } from "./message";
import { Model } from "./model";
import type { Link } from "./model";
import { managedResources, subscriptions } from "./socket";
import type { PiSocketService } from "./socket";
import { update } from "./update";
import { view } from "./view";

const params = new URLSearchParams(globalThis.location.search);

const initialLink: Link = params.has("token") ? "connecting" : "closed";

const application = Runtime.makeElement<Model, Message, never, PiSocketService>({
	Model,
	init: () => ({
		model: {
			session: params.get("session") ?? "demo",
			token: params.get("token") ?? "",
			draft: "",
			entries: [],
			link: initialLink,
			epoch: 0,
			failures: 0,
			busyVia: null,
			tcpPeers: 0,
			webPeers: 0,
			tcpHost: params.get("tcp") ?? "127.0.0.1 7000",
		},
		commands: [],
	}),
	update,
	view,
	subscriptions,
	managedResources,
	container: document.getElementById("root"),
	devTools: { Message },
});

Runtime.run(application);
