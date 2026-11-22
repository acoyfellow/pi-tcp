# pi-tcp

Talk to a durable Pi agent over raw TCP. No container, no HTTP, no WebSocket.

```
nc / any TCP client ──▶ Spectrum ──▶ Worker connect() ──▶ PiSession Durable Object
                                      token + session        Pi Durable harness in SQLite
```

Each session name is one Durable Object. The conversation lives in its SQLite storage, so you can drop the connection, reconnect from anywhere, and keep going.

Built on [inbound TCP for Workers](https://developers.cloudflare.com/changelog/post/2026-11-19-inbound-tcp/) (public beta) and [`@earendil-works/pi-durable`](https://www.npmjs.com/package/@earendil-works/pi-durable).

## Protocol

Newline-delimited JSON, close to Pi's RPC mode.

1. Send your token on the first line.
2. Send a session name (`[a-z0-9-]{1,63}`) on the second line.
3. Then send commands, one JSON object per line.

| Command | Reply |
|---|---|
| `{"id":"1","type":"prompt","message":"..."}` | a `response`, then one `entry` per new entry, then `agent_settled` |
| `{"id":"2","type":"get_messages"}` | every entry in the session |
| `{"id":"3","type":"replay","after":15}` | entries after id 15, for resuming after a reconnect |
| `{"id":"4","type":"abort"}` | stops the current turn |

A bad token gets `{"type":"refused","reason":"bad token"}`, and the connection closes.

## Run it locally

```sh
npm install
npx wrangler dev --var PI_TCP_TOKEN:dev-token
PI_TCP_TOKEN=dev-token node client/pi-tcp.mjs 127.0.0.1:7000 demo
```

Or use `nc`:

```sh
(printf 'dev-token\ndemo\n{"id":"1","type":"prompt","message":"hi"}\n'; sleep 20) | nc 127.0.0.1 7000
```

The `AI` binding always calls Workers AI remotely, even in local dev, so prompts cost a little.

## Deploy

```sh
npx wrangler deploy
openssl rand -hex 24 | npx wrangler secret put PI_TCP_TOKEN
```

Then create a Spectrum application that sends one TCP port to this Worker. Refer to [Route TCP traffic to a Worker](https://developers.cloudflare.com/spectrum/how-to/route-tcp-traffic-to-a-worker/). It needs a Pro or Business zone. Without Spectrum Enterprise, a zone gets one Worker-origin app on one port.

## What this does not do

- **No TLS.** The token and prompts cross the network in plain text. Spectrum without Enterprise can't terminate TLS for a Worker origin, and Workers can't call `startTls()` on inbound sockets. Use it for demos, or wrap it in your own TLS.
- **No streaming tokens.** You get each entry after the turn settles.
- **No shell or file tools.** The agent has only the model. For a real Linux box, refer to `examples/container/`.
- **One shared token.** Anyone with the token can open any session.

## Proof

- Local: [receipts/local-2026-11-22.md](receipts/local-2026-11-22.md). It shows a refused bad token, a prompt, a reconnect that remembers the earlier turn, replay after a cursor, and session isolation.
- Production through Spectrum is **not verified yet**. My zones are on the Free plan.

## examples/container

The same idea with a Container behind the Durable Object. socat runs the stock `pi --mode rpc`. The Durable Object to Container hop worked in production: a `get_state` round trip took 750–2,000 ms. In local `wrangler dev` on macOS arm64, the same hop failed with `Network connection lost`.

## License

MIT
