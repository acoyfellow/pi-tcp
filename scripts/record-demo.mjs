import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.PI_TCP_URL ?? "http://localhost:8791";
const TCP = process.env.PI_TCP_ADDR ?? "127.0.0.1 7000";
const TOKEN = process.env.PI_TCP_TOKEN ?? "dev-token";
const OUTPUT = new URL("../media/", import.meta.url).pathname;
const DEMO_FILES = new URL("demo/", import.meta.url).pathname;
const TERMINAL_PORT = 5399;
const SIZE = { width: 800, height: 760 };
const TYPE_DELAY_MS = 18;
const REPLY_TIMEOUT_MS = 60_000;
const TRIM_SECONDS = "1.5";

const session = `demo-${Math.random().toString(36).slice(2, 6)}`;
const command = `(printf '${TOKEN}\\n${session}\\n{"type":"prompt","message":"What is 2+2?"}\\n'; sleep 40) | nc ${TCP}`;
const listeners = new Set();

const pause = (ms) => new Promise((resolve) => {
	setTimeout(resolve, ms);
});
const emit = (event) => {
	for (const response of listeners) {
		response.write(`data: ${JSON.stringify(event)}\n\n`);
	}
};

const serveTerminal = () =>
	createServer(async (request, response) => {
		if (request.url === "/stream") {
			response.writeHead(200, { "content-type": "text/event-stream" });
			listeners.add(response);
			return;
		}
		const file = request.url === "/terminal.js" ? "terminal.js" : "terminal.html";
		const type = file.endsWith(".js") ? "text/javascript" : "text/html";
		response.writeHead(200, { "content-type": type });
		response.end(await readFile(join(DEMO_FILES, file)));
	}).listen(TERMINAL_PORT);

const runNetcat = () => {
	const child = spawn("sh", ["-c", command]);
	let buffer = "";
	child.stdout.on("data", (chunk) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const text of lines.filter(Boolean)) {
			emit({ type: "line", text });
		}
	});
	return child;
};

const run = (program, args) =>
	new Promise((resolve, reject) => {
		spawn(program, args, { stdio: "inherit" }).on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`))));
	});

const firstVideo = async (directory) => join(directory, (await readdir(directory)).find((name) => name.endsWith(".webm")));

const record = async (workDirectory) => {
	const browser = await chromium.launch({ executablePath: CHROME, headless: true });
	const openPage = async (name) => {
		const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: join(workDirectory, name), size: SIZE }, colorScheme: "light" });
		return context.newPage();
	};
	const web = await openPage("web");
	const terminal = await openPage("terminal");
	await Promise.all([web.goto(`${BASE}/?session=${session}`), terminal.goto(`http://localhost:${TERMINAL_PORT}/`)]);
	await web.getByText("Live").waitFor({ timeout: 20_000 });
	await pause(1800);
	emit({ type: "type", text: command });
	await pause(command.length * TYPE_DELAY_MS + 700);
	const netcat = runNetcat();
	const agentTurns = web.locator("[role=log] li.items-start");
	await agentTurns.first().waitFor({ timeout: REPLY_TIMEOUT_MS });
	await pause(2500);
	const prompt = web.locator("#prompt");
	await prompt.click();
	await prompt.pressSequentially("and times 3?", { delay: 70 });
	await pause(400);
	await prompt.press("Enter");
	await agentTurns.nth(1).waitFor({ timeout: REPLY_TIMEOUT_MS });
	await pause(3500);
	netcat.kill();
	await web.context().close();
	await terminal.context().close();
	await browser.close();
};

const encode = async (workDirectory) => {
	const terminalVideo = await firstVideo(join(workDirectory, "terminal"));
	const webVideo = await firstVideo(join(workDirectory, "web"));
	const mp4 = join(OUTPUT, "demo.mp4");
	await run("ffmpeg", [
		"-y", "-v", "error", "-i", terminalVideo, "-i", webVideo,
		"-filter_complex", `[0:v]setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]hstack=inputs=2,trim=start=${TRIM_SECONDS},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v]`,
		"-map", "[v]", "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-movflags", "+faststart", mp4,
	]);
	await run("ffmpeg", [
		"-y", "-v", "error", "-i", mp4,
		"-vf", "fps=10,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
		join(OUTPUT, "demo.gif"),
	]);
};

const server = serveTerminal();
const workDirectory = await mkdtemp(join(tmpdir(), "pi-tcp-demo-"));
try {
	await record(workDirectory);
	await encode(workDirectory);
	process.stdout.write(`recorded session ${session} to media/demo.mp4 and media/demo.gif\n`);
} finally {
	server.close();
	await rm(workDirectory, { recursive: true, force: true });
}
