import { foldkit } from "@foldkit/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const WORKER_PORT = process.env.PI_TCP_WORKER_PORT ?? "8791";

export default defineConfig({
	root: import.meta.dirname,
	plugins: [foldkit(), tailwindcss()],
	build: { outDir: "../public", emptyOutDir: true },
	server: { port: 5291, strictPort: true, proxy: { "/ws": { target: `ws://localhost:${WORKER_PORT}`, ws: true } } },
});
