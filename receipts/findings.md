# Findings

Customer 0 notes from building pi-tcp on the inbound TCP beta (changelog 2026-11-19). Each line has what we saw, where, and what would fix it.

## Inbound TCP

- **Local dev works for Worker `connect()`.** `wrangler dev` 4.166.0 listens on the configured port, and `nc 127.0.0.1 7000` reaches the handler. Worker to Durable Object `connect()` works locally too.
- **Local Durable Object to Container `getTcpPort()` fails on macOS arm64.** The error is `Network connection lost`. The same hop works in production, at 750–2000 ms per connect. We removed the container variant from this repo for that reason. To reproduce, call `getTcpPort(port).connect()` from a Durable Object to a container under `wrangler dev`.
- **Public TCP needs Spectrum on a Pro or Business zone.** Both test zones are on the Free plan. The Spectrum API returned 403 on one and "Zone not found" on the other, where the login could not reach the zone's account. Nothing in this repo is proven over the public internet yet.
- **No TLS for Worker origins without Spectrum Enterprise, and no `startTls()` on inbound sockets.** The token crosses the network in plain text, so this stays a demo.
- **Port 7000 conflicts.** On macOS, AirPlay Receiver and other local dev servers can hold port 7000 or send stray HTTP to it. The Worker treats stray HTTP as a bad token.

## Pi Durable 1.6

- **No event stream.** There is no `watchEvents`. Turns reach peers only after an entry is written, so there is no per-token streaming. The Durable Object reads entries after `submit` and again after `wait`.
- **No transport field on entries.** The Durable Object tags each user entry with its source in DO KV (`via:<id>`). A `metadata` field on `submit` would remove that.

## Tooling

- **`@cloudflare/oxlint-config` 0.1.0** was adopted with no rule overrides. The fixes it forced were real: assertion chains in the Workers AI binding fetch, `any` leaking from `Socket.readable`, and namespace imports.
- **Workers types give `Socket.readable` as `ReadableStream<any>`.** Every caller has to narrow it. `src/lines.ts` `byteReader` does this once.
- **`Ai.run` has no overload for a raw Response with a model name that is not in the generated list.** `@cf/deepseek-ai/deepseek-v4.1-flash-1017` is not in `AiModelList` yet. The code uses the fallback overload and narrows the result.
- **The cmux browser `eval` runs in an isolated world.** Page globals and `console` output can't be seen. Use Playwright with system Chrome to debug.

## tinyactors 0.4.0 in a Durable Object (2026-11-22)

- **Works.** `@tinyactors/wasm` runs `src/charts/room.scxml` inside a Durable Object under `wrangler dev`. It sent 27 posts to a fresh room: 20 turns delivered, 1 out-of-turn post rejected, then `closed {"turns":20}`. The run took 20 ms with the simulated clock and made no model calls. Reproduce with `spikes/tinyactors/`.
- **Use `datamodel: "quickjs"` on the Host, not on the chart.** Workers forbid `eval`, so the native datamodel can't run. The chart keeps `datamodel="ecmascript"`. Putting `quickjs` in the chart fails with `UnsupportedError: a chart's datamodel is not in this host`. Putting it in `config` fails with `InvalidError ... path: datamodel`.
- **Import `@tinyactors/wasm/init` and pass the wasm module.** The default entry reads `new URL('../tinyactors.wasm', import.meta.url)` when it loads, which breaks workerd startup with `Invalid URL string`. Fix: set wrangler `define` for `import.meta.url`, add a `CompiledWasm` rule, and call `init(wasm)`.
- **Size:** 1366 KiB upload, 512 KiB gzip with the quickjs engine included.
- **Not yet proven:** the actor surviving Durable Object eviction (needs a `Store` on DO storage), and real agents in the room.
