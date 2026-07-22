# Security policy

Thanks for taking the time to report something. This document covers how to reach us, what to
expect, and what counts as in scope.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting:
[open a report](https://github.com/withsetu/setu/security/advisories/new).** That channel is
private between you and the maintainers, gives us a private fork to develop the fix in, and lets
us credit you on the published advisory.

Please do **not** open a public issue for anything that would expose a running Setu instance.
Everything else — CI hardening, dependency posture, missing test coverage for a gate that already
enforces correctly — belongs in a normal public issue with the `security` label, and we would
rather have those in the open.

### What to include

A path to reproduce is worth more than a severity rating. Where you can:

- the affected version or commit,
- the topology it applies to (local app, self-hosted Node, or Cloudflare edge — see
  [docs/architecture.md](docs/architecture.md)),
- the role or actor needed to reach it (unauthenticated, author, editor, maintainer, admin),
- what an attacker gains.

### What to expect

- **Acknowledgement within 3 business days.** If you don't hear back, please ping the advisory
  thread — a missed notification is far more likely than a decision not to reply.
- An assessment and a rough remediation timeline within 10 business days.
- Credit on the published advisory unless you'd rather stay anonymous.

We'll keep you in the loop through the advisory thread rather than going quiet until the fix
ships. If we conclude something isn't exploitable, we'll say so with our reasoning rather than
closing it silently — and we may still fix it as hardening.

### Safe harbour

We won't pursue or support legal action against anyone acting in good faith under this policy:
research on your own instance, no access to or modification of other people's data, no
degradation of a service you don't run, and a reasonable window for us to fix before public
disclosure. If you're unsure whether something is in bounds, ask first in the advisory thread.

## Supported versions

Setu is pre-1.0 and ships no released versions yet. Only the current `main` branch is supported;
fixes land there and are not backported.

## Scope

**In scope** — anything reachable in a running Setu instance:

- The admin API (`apps/api`) — authentication, the role/permission matrix, the server-side
  `requireCan` gates, and the Git write path.
- The admin SPA (`apps/admin`) where a client-side flaw crosses into a server effect. Note that UI
  gating (`useCan`) is UX, not a security boundary, and we treat it that way deliberately — a
  hidden button whose API is open is a real finding, but a visible button whose API correctly
  rejects is not.
- Rendered site output (`apps/site`, themes, block renderers) — injection through content or
  settings into a published page.
- Content and media handling: Markdoc parsing, frontmatter, uploads, and path resolution.

**Out of scope:**

- Findings that require an already-trusted actor to act within permissions they legitimately
  hold. An admin can, by design, do admin things.
- The `.content-sandbox/` dev sandbox, dev-only tooling gated behind `import.meta.env.DEV`, and
  local CLI scripts under `scripts/` that require the operator to run them against their own
  machine.
- This repo's own CI/CD hardening — please file it as a public issue instead; it exposes no
  instance and we'd rather discuss it in the open.
- Missing tests for a gate that already exists and fails closed. Also a public issue.
- Automated scanner output with no demonstrated path to impact.

## Our own posture

The standards we hold contributions to are in
[docs/security-standards.md](docs/security-standards.md) — server-side authorization that fails
closed, Zod at every boundary, a shared safe-fetch seam, and a wrong-actor end-to-end test for any
change to an authentication or authorization gate.

On supply chain: third-party GitHub Actions are pinned by full commit SHA. Actions under
`actions/*` and `github/*` are GitHub-owned and may be tag-pinned. `pnpm audit --audit-level=high`
gates every pull request, and lifecycle-script execution is restricted to an explicit
`onlyBuiltDependencies` allowlist.
