import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve("axe-core/axe.min.js");
const URL_BASE = process.env.PI_TCP_HTTP ?? "http://localhost:8791";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTHS = [1280, 390];
const SCHEMES = ["light", "dark"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const failures = [];
const fail = (label, detail) => {
	failures.push(`${label}: ${detail}`);
	process.stdout.write(`FAIL ${label}: ${detail}\n`);
};
const pass = (label) => process.stdout.write(`PASS ${label}\n`);

async function audit(page, label) {
	await page.addScriptTag({ path: AXE_PATH });
	const result = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: tags }), TAGS);
	if (result.violations.length === 0) {
		pass(`axe ${label}`);
	}
	for (const violation of result.violations) {
		fail(`axe ${label}`, `${violation.id} (${violation.impact}) at ${violation.nodes[0]?.target.join(" ")}`);
	}
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > globalThis.innerWidth);
	if (overflow) {
		fail(`overflow ${label}`, "page scrolls sideways");
	}
}

async function waitLive(page) {
	await page.getByRole("status").filter({ hasText: "Live" }).waitFor({ timeout: 15_000 });
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
	for (const colorScheme of SCHEMES) {
		for (const width of WIDTHS) {
			const page = await browser.newPage({ colorScheme, viewport: { width, height: 844 } });
			await page.goto(`${URL_BASE}/?session=a11y-empty-${colorScheme}-${width}`);
			await waitLive(page);
			await audit(page, `empty ${colorScheme} ${width}`);
			await page.close();
		}
	}

	const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
	const page = await context.newPage();
	const session = `a11y-${Date.now().toString(36)}`;
	await page.goto(`${URL_BASE}/?session=${session}`);
	await waitLive(page);

	const order = [];
	for (let step = 0; step < 2; step += 1) {
		await page.keyboard.press("Tab");
		order.push(await page.evaluate(() => (document.activeElement?.id || document.activeElement?.textContent?.trim()) ?? ""));
	}
	const expected = ["Copy", "prompt"];
	if (order.join() === expected.join()) {
		pass(`keyboard order ${order.join(" → ")}`);
	} else {
		fail("keyboard order", `${order.join(" → ")} (wanted ${expected.join(" → ")})`);
	}

	await page.getByRole("button", { name: "Copy" }).click();
	const copied = await page.getByRole("button", { name: "Copied" }).waitFor({ timeout: 2000 }).then(() => true, () => false);
	const clipboard = await page.evaluate(() => navigator.clipboard.readText());
	if (copied && clipboard.includes(session)) {
		pass("copy button copies the command");
	} else {
		fail("copy button", `label copied=${copied}, clipboard has session=${clipboard.includes(session)}`);
	}

	const send = page.getByRole("button", { name: "Send" });
	if (await send.isDisabled()) {
		pass("send is disabled while empty");
	} else {
		fail("send while empty", "enabled");
	}
	const input = page.getByRole("textbox", { name: "Message" });
	await input.click();
	await page.keyboard.type("Reply with exactly: a11y ok");
	if (await page.waitForFunction(() => !document.querySelector("button[type=submit]")?.disabled, null, { timeout: 2000 }).then(() => true, () => false)) {
		pass("send is enabled after typing");
	} else {
		fail("send after typing", "still disabled");
	}
	await page.keyboard.press("Enter");
	await page.getByText("From browser").waitFor({ timeout: 10_000 });
	await page.locator("[role=log] li.items-start").first().waitFor({ timeout: 60_000 });
	await page.getByText("Agent is replying").waitFor({ state: "hidden", timeout: 60_000 });
	const draftCleared = (await input.inputValue()) === "";
	const focusKept = await page.evaluate(() => document.activeElement?.id === "prompt");
	if (draftCleared && focusKept) {
		pass("enter sends, clears the draft and keeps focus");
	} else {
		fail("after send", `cleared=${draftCleared}, focus kept=${focusKept}`);
	}

	for (const colorScheme of SCHEMES) {
		await page.emulateMedia({ colorScheme });
		for (const width of WIDTHS) {
			await page.setViewportSize({ width, height: 844 });
			await audit(page, `with turns ${colorScheme} ${width}`);
			await page.screenshot({ path: `/tmp/pi-tcp-a11y-${colorScheme}-${width}.png` });
		}
	}
	await context.close();
} finally {
	await browser.close();
}

process.stdout.write(failures.length === 0 ? "\na11y: all checks pass\n" : `\na11y: ${failures.length} failing\n`);
process.exit(failures.length === 0 ? 0 : 1);
