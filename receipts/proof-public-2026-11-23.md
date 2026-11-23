# Public proof: 2026-11-23

Claim: Over the public internet, a Spectrum app with a Worker origin carries raw TCP to the PiSession Durable Object: a bad token is refused, a prompt is answered, and a second TCP peer on the same session sees the turn and the reply.

Result: **proven** against `pi-tcp.abs-staging.cloudflarestorage.com:7000` at 2026-11-23T10:10:50.342Z. Session `public-mwt3v0x2`.

| Check | Result | Detail |
|---|---|---|
| a bad token is refused | pass | "bad token" |
| the token opens a session | pass | ready in 290 ms |
| two TCP peers join one session | pass | 2 tcp |
| the prompt is answered | pass | "public tcp ok" in 986 ms |
| the other peer sees the turn | pass | entry #7 via tcp, reply #11 |

Scope: TCP only. The public web page is behind Cloudflare Access, so the browser half is proven locally by `npm run proof`, not here.

Reproduce: `npm run proof:public` with the token in `PI_TCP_TOKEN` or `~/.config/pi-tcp/kitchen-token`.
