# Setu security standards

Standing reference (like [quality-bar.md](quality-bar.md)) — things the code must uphold, read
repeatedly. Established via #292 (2026-07-02 security audit). Framework: **OWASP Top 10:2025**.

**When this applies:** every time an issue is **picked** for development, and again in **review**.
The pick-time checklist below is part of the Definition of Done: a feature that ships a new route,
input, fetch, or dependency without answering these questions is not done, exactly as a
skeleton UI is not done.

## Pick-time checklist

Answer these for ANY issue before writing code. Most answers are "N/A" in one line — the point is
that the question was asked. If any answer is non-trivial, add a **"Security considerations"**
section to the issue body and the `security` label.

1. **New route/endpoint?** → It enforces authz via the engine (#232), and errors **fail closed**
   (#291). Unauthenticated → 401; unauthorized → 403.
2. **New input?** (form field, query param, frontmatter, file upload, import) → Zod-validated at
   the boundary; size-capped; file types constrained.
3. **Server-side fetch of any URL?** → goes through the shared safe-fetch helper (#288). No raw
   `fetch` of user- or config-supplied URLs. Applies to oEmbed, probes, webhooks, importers.
4. **Renders user-supplied or third-party content?** → XSS review: sanitized, sandboxed, or inert
   (`markdocPassthrough` re-emits as text, never live HTML). Custom HTML/JS stays **admin-only**
   (PRD §18, #260).
5. **Parses a structured format?** (XML, zip, CSV) → parser hardened: XXE/DTD disabled, expansion
   and size limits (#258 is the reference case).
6. **New dependency?** → supply-chain check: maintained? install scripts? license on the
   allowlist (#281)? Prefer the injected-`fetch`/existing-port pattern over new HTTP/util deps.
7. **Touches auth, sessions, or cookies?** → CSRF covered; `HttpOnly`/`Secure`/`SameSite` flags;
   rate limiting (#248). JWTs are **signature-verified**, never trusted from a header (#249).
8. **Secrets involved?** → env only, never Git, never `settings.json`, never logged. gitleaks/push
   protection will catch you (#218) — don't make it.
9. **Security-relevant event?** (login, role change, publish, force-unlock, denial) → recorded in
   the audit log (#290).
10. **Errors and edge cases** → no stack traces/paths/SQL in prod responses; exceptional paths
    deny rather than allow (#291).
11. **Topology check (existing rule, security lens):** does the mitigation hold on local, VPS,
    and edge? A guard that only works on Node is a hole on Workers — degrade honestly, never
    silently.

## OWASP Top 10:2025 → Setu mapping

| # | Category | Setu surfaces | Tracking |
|---|---|---|---|
| A01 | Broken Access Control (incl. SSRF) | authz engine; admin CRUD gating; private media; presigned uploads; **all server-side fetches** | #232 ✅ · #110 · #138 · #250 · **#288 (safe-fetch)** |
| A02 | Security Misconfiguration | security headers (emit, not just probe); honest topology gating | **#289 (emit headers)** · #200 (probe) |
| A03 | Software Supply Chain Failures | many OSS deps; GitHub Actions; npm publishing | #218 (Dependabot/audit) · #281 (Scorecard, SHA-pinning, licenses) · #278 (provenance) |
| A04 | Cryptographic Failures | password hashing; session tokens; HTTPS/HSTS | #248 (Better Auth) · #289 |
| A05 | Injection | XSS via embeds/oEmbed/imported HTML; Markdoc rendering; SQL (Drizzle-parameterized); Zod at boundaries | #260 · #187 · #258 · SAST in #218 |
| A06 | Insecure Design | threat surfaces named in PRD §18/§26.2; DoW defenses; design-in-issues + this checklist | #292 ✅ (this doc) |
| A07 | Authentication Failures | real login/sessions; CSRF; rate limiting; verified Access JWTs | **epic #247** → #248 ✅ (this branch) · #249 · #110 |
| A08 | Software or Data Integrity Failures | Actions pinned to SHA; publish provenance; secret scanning; CI-cache false-green guardrail | #281 · #278 · #218 · #216 |
| A09 | Security Logging & Alerting Failures | auth/authz audit log + lockout alerting; auth events (login/logout/role-change/ban/setup) now emitted via a structured `onAuthEvent` seam (#248), awaiting a persistence/alerting consumer | **#290** |
| A10 | Mishandling of Exceptional Conditions | fail-closed authz; no-leak error envelope; non-enumeration | **#291** |

✅ = shipped. Bold = filed specifically to close a 2025-category gap. Keep this table current:
when a security issue ships or a new surface appears, update the row in the same PR/issue.

## The server-side fetch pattern (`safeFetch`, #288)

Any server-side fetch of a URL that is user-supplied or config-driven (oEmbed, live-site
probes, deploy hooks, form webhooks, remote importers) goes through **`safeFetch` from
`@setu/core`** (`packages/core/src/net/safe-fetch.ts`) — never a raw `fetch`. What it
enforces, all fail-closed and re-checked on every redirect hop:

- **https only** (`allowHttp` is a dev opt-in); URLs carrying credentials are rejected.
- **Private/internal targets blocked**: localhost, IPv4 private/loopback/link-local/
  metadata/multicast/reserved ranges, IPv6 loopback/ULA/link-local/multicast — including
  IPv4-mapped (`::ffff:…`) and NAT64 forms.
- **DNS pre-check** via the injected `resolveHost` (the topology seam): Node callers pass a
  resolver so every A/AAAA answer is range-checked before the socket opens; Workers omit it
  and keep the remaining checks. Resolver failure = blocked.
- **Per-surface host allowlists** (`allowHosts`) where the surface has one (e.g. the oEmbed
  provider registry).
- **Redirects followed manually and capped** — each hop re-runs the full validation.
- **Size + time caps** (`maxBytes` Content-Length pre-check plus a hard cap while reading;
  `timeoutMs` via AbortSignal); the result comes back fully buffered.

Known limitation (accepted for now): resolve-then-fetch leaves a DNS-rebinding TOCTOU
window; true pinning needs a non-portable custom agent. The pre-check + per-hop
re-validation is the agreed mitigation level — revisit if a surface ever handles
credentials or writes based on the fetched body.

## Issue-authoring rules

- Security-relevant issues carry the **`security` label** and a **"Security considerations"**
  section in the body (what's the surface, what's the mitigation, what's the DoD test).
- New fetch/parse/embed/import features MUST reference the shared mitigations (#288 safe-fetch,
  XXE rules, sandbox rules) in their DoD — see #187 and #258 for the pattern.
- Reviews block on this checklist the same way they block on polish (quality-bar.md): a feature
  with an unanswered checklist line fails the Definition of Done.

## Standing process (PRD §26.2)

- Per milestone: diff-level `/security-review`.
- Before 1.0 GA: third-party penetration test (Setu handles auth + content + PII).
- The bar scales with topology: self-hosted single-tenant < managed multi-tenant Cloud.
