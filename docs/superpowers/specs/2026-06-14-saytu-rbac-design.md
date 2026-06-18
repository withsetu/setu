# Design — Roles & Permissions (RBAC) — model + arc

_Date: 2026-06-14 · Status: design pinned; built in phases_

## Purpose

Saytu needs role-based access control: an admin specifies what each user role may
do, and the engine + UI enforce it. The publish/deploy lifecycle surfaced it —
"editor publishes, publisher deploys" is a permissions statement. This doc pins the
full model so it's nailed down; it is **built in phases** (the capability seam ships
with the publish increment; the admin UI + real auth come later, after users/auth
exist).

## The model

**Roles** (default set; the matrix is customizable by an admin):
- **Owner / Admin** — everything, incl. managing users, roles, settings, theme.
- **Publisher** — `site.deploy` + everything an Editor can do.
- **Editor** — create/edit/`content.publish` (commit) / `content.unpublish`.
- **Author** — create/edit own drafts; publishing goes through review (no direct
  `content.publish`).
- **Viewer** — read-only.

**Actions** (the permission vocabulary — flat, global to start; per-resource "own
vs any" scoping is a later refinement):
`content.create · content.edit · content.delete · content.publish ·
content.unpublish · site.deploy · users.manage · roles.manage · settings.manage ·
theme.manage`

**Permission matrix:** a `Record<Role, Set<Action>>`. Default roles ship with
sensible defaults; an admin can edit the matrix (which actions each role gets).

**The API (pure, core, edge-safe — `@setu/core/src/authz/`):**
```ts
type Action = 'content.create' | 'content.edit' | ... // the vocabulary
interface Actor { id: string; role: Role }
function createAuthz(matrix: PermissionMatrix): { can(actor: Actor, action: Action): boolean }
```
`can` is pure (actor's role → the matrix's allowed set). The default matrix
(`DEFAULT_ROLES`) ships in core. Services and the UI both consult `can()`: the UI
hides/disables, the engine enforces (defense in depth — never trust the UI alone).

**Enforcement:** the action-taking services (publish, deploy, authoring,
settings, user-management) accept an `Actor` and check `can()` before acting; a
denied action returns a `forbidden` result (never a silent no-op, never a partial
write). The cardinal rule (never lose content) holds — a forbidden publish/deploy
changes nothing.

**The admin UI** (Settings → "Users & Roles"):
- A **role × action matrix** (rows = roles, columns = actions, checkboxes) — the
  admin sets what each role can do.
- **Assign roles to users** (needs users/auth to exist).

**UI gating pattern (agreed):** lifecycle/status is shown as a **read-only derived
pill** to everyone; the **state-changing actions live in a role-gated control** (a
"Publish ▾" dropdown / overflow) visible+enabled only when `can(actor, action)` is
true. Viewer → pill only; Editor → the dropdown with permitted actions.

## Where things live

- **Matrix + roles + `can()`** → `@setu/core/src/authz/` (pure, edge-safe,
  contract-style tests). The default matrix ships here.
- **Persisted custom matrix + user→role assignments** → the DB (a settings/roles
  store), once persistence/users land. Until then, the default matrix + a single
  hardcoded Owner actor.
- **Current actor** → provided by auth (the AuthPort). Until auth exists, the app
  injects a constant **Owner** actor via context (`useActor()`), so every gated
  action already flows through `can()` with zero throwaway when real auth lands.

## Build phases (sequencing)

```
1. Capability seam (NOW, with the publish increment)
   - action vocabulary + DEFAULT_ROLES matrix + can() in core/authz
   - app provides a constant Owner actor via useActor()
   - Publish / Deploy / Unpublish gated by can() (Owner ⇒ allowed; seam in place)
2. Auth + users (own increment) — the AuthPort (GitHub OAuth / CF Access / pw),
   users, sessions; real current actor.
3. Admin Users & Roles UI (own increment) — the role×action matrix editor +
   assigning roles to users; persisted custom matrix. Needs (2).
4. Full enforcement sweep — every service action behind can(); forbidden results
   surfaced in the UI.
```

## Why these choices

- **Bake the seam now, defer the weight.** Wiring `can()` into Publish/Deploy/
  Unpublish from day one means roles are never an afterthought; but the heavy parts
  (auth, the matrix UI) wait for their prerequisites (users) rather than blocking
  the visible publish feature.
- **Pure `can()` in core.** Authorization is pure logic — testable, edge-safe,
  reusable by the server, the edge, and the browser, exactly like the other ports/
  policies. The matrix is data, so admins customize it without code.
- **Roles live in the app (not the auth provider).** Per the PRD: auth is a
  pluggable adapter (who you are); roles/permissions are always app-level (what you
  may do). This keeps RBAC provider-agnostic.

## Deferred / open

- Per-resource scoping (own vs any; per-collection roles) — start global, refine
  later.
- Review/approval workflow for the Author role (submit → Editor publishes).
- Audit log of gated actions.
- Pro-feature gating is licensing, not RBAC — kept separate.
