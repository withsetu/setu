# Setu

An open-source, Git-backed CMS that runs as a local app, a self-hosted Node server, or on the edge
(Cloudflare Workers/Pages). Content lives in Git as Markdoc; the admin is a React SPA; the site is
Astro.

## Development

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev        # api :4444 · admin :5173 · site :4321
pnpm test       # run the test suites
pnpm typecheck  # whole-repo typecheck
```

## Staging environment

`pnpm staging` assembles a staging-parity stack that simulates the **self-hosted Node topology**
on your machine: production builds, real HTTPS, secure cross-origin cookies, and real SMTP
delivery — the class of thing `pnpm dev` (dev servers, plain http, console email) cannot
exercise. Nothing about it ships to production.

**Prerequisites** (two brew-installable binaries, no Docker):

```bash
brew install caddy mailpit
```

**Start / stop:**

```bash
pnpm staging        # seed sandbox → build admin+site for production → api + Mailpit + Caddy
pnpm staging:stop   # stops only the processes `pnpm staging` recorded (pid-verified, no port kills)
```

Four HTTPS origins come up (subdomains on `*.setu.localhost`, which resolves to loopback natively
in every modern browser — no hosts-file setup). Distinct origins are deliberate: they force the
honest cross-origin problems (`Secure`/`SameSite` cookies, CORS allowlist, `SETU_ADMIN_ORIGIN`)
that otherwise only surface on real deployments:

| Origin | What it serves |
| --- | --- |
| `https://setu.localhost` | the production-built Astro site |
| `https://admin.setu.localhost` | the production-built admin SPA |
| `https://api.setu.localhost` | the api, booted in self-hosted posture |
| `https://mailpit.setu.localhost` | Mailpit's web UI (captured email) |

Caddy fronts `:443`/`:80` by default (macOS allows unprivileged low-port binding). If another
stack on your machine permanently owns those ports (Docker Desktop, DDEV, a local nginx), set
`SETU_STAGING_HTTPS_PORT`/`SETU_STAGING_HTTP_PORT` in `.env` — every staging origin then carries
the explicit suffix (e.g. `https://admin.setu.localhost:8443`); the preflight error tells you
exactly this when it detects the collision.

**Signing in (first run):** the api boots in self-hosted posture with an empty user table, so it
mints a one-time **setup token** — `pnpm staging` prints it once the stack is ready. Open
`https://admin.setu.localhost`, and the setup screen asks for that token to create the owner
account. Users, content, drafts, and uploads persist in the gitignored
`.content-sandbox/staging/`; `pnpm content:reset staging` (while staging is stopped) is a full
factory reset. Password-reset emails, forms notifications, and any other outbound mail land in
Mailpit — nothing ever leaves your machine (Mailpit binds loopback only).

**Certificates — what `caddy trust` installs and how to remove it:** Caddy issues the HTTPS
certificates from its own **local CA** (created under `~/Library/Application Support/Caddy` on
macOS). On first run Caddy attempts to add that CA's root certificate to the **system trust
store** (macOS Keychain), which prompts for your password; if you skipped or it failed, run
`caddy trust` once and the browser warnings disappear. This trusts only Caddy's local,
machine-private CA — no third party. To undo it completely: `caddy untrust` (removes the root
from the trust store), then delete Caddy's data directory above to destroy the CA itself.

**Configuration:** the profile works with zero configuration and zero secrets. To override a
value, copy the tracked [`.env.example`](.env.example) to an untracked `.env` (loaded only by the
staging script; precedence: script defaults < `.env`). The defaults point email at Mailpit's SMTP
sink and enable Cloudflare's public Turnstile **test keys** (auto-pass, loudly flagged in the api
boot log — see [apps/api/README.md](apps/api/README.md) for the test-key story). The
session-signing secret is generated per sandbox, never tracked. Real secrets belong in `.env`
only — never in `.env.example`, never committed.

Internals, ports (api `:4460`, SMTP `:11026`, Mailpit UI `:18026`; Caddy fronts `:443`), and the
stop-safety rules live in [`scripts/staging.mjs`](scripts/staging.mjs).

## License

Setu is licensed under the [MIT License](LICENSE). Contributions are accepted under the
[Developer Certificate of Origin](CONTRIBUTING.md#developer-certificate-of-origin-dco) — sign off
your commits with `git commit -s`. See [CONTRIBUTING.md](CONTRIBUTING.md).
