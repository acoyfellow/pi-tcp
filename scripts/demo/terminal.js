const out = document.querySelector("#out");
const TYPE_DELAY_MS = 18;

const append = (className, text) => {
	const line = document.createElement("div");
	line.className = className;
	line.textContent = text;
	out.append(line);
};

const pause = (ms) => new Promise((resolve) => {
	setTimeout(resolve, ms);
});

const typeCommand = async (text) => {
	const line = document.createElement("div");
	const prompt = document.createElement("span");
	const typed = document.createElement("span");
	prompt.className = "prompt";
	prompt.textContent = "$ ";
	typed.className = "typed";
	line.append(prompt, typed);
	out.append(line);
	for (const character of text) {
		typed.textContent += character;
		await pause(TYPE_DELAY_MS);
	}
};

const parseFrame = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

const showFrame = (text) => {
	const frame = parseFrame(text);
	if (frame?.type !== "entry") {
		append("frame", text);
		return;
	}
	const { entry } = frame;
	if (entry.kind !== "user") {
		append("agent", `agent › ${entry.text}`);
		return;
	}
	const source = entry.via === "tcp" ? "tcp" : "web";
	append(source, `${source === "tcp" ? "terminal" : "browser"} › ${entry.text}`);
};

new EventSource("/stream").addEventListener("message", (message) => {
	const event = JSON.parse(message.data);
	if (event.type === "type") {
		void typeCommand(event.text);
		return;
	}
	showFrame(event.text);
});
