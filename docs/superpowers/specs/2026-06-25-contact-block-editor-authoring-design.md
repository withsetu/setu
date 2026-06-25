# Contact Block — Editor Authoring — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `contact-editor-authoring` (stacked on `forms-basic` / PR #39)

## Summary

The basic-forms feature ([PR #39](https://github.com/saytudev/setu/pull/39)) ships the
`contact` block end-to-end on the **site** (render → submit → inbox). But in the **admin
editor** the block falls back to the generic folder-block node: it shows only the label
"Contact form" with no live preview, and its props are reachable only through a bare generic
attribute form — so an author can't see the form or meaningfully configure it (e.g. there
was no obvious way to enable the Subject field).

This slice gives the contact block a **dedicated editor node**: a live, static preview of the
form plus a tidy "Form settings" popover to configure it. It follows the existing
dedicated-node pattern used by `callout` and `image`. No changes to the site renderer, the
submission pipeline, or the inbox — they consume the same Markdoc attributes this node writes.

## Goals

- An author who inserts the contact block **sees** the form as a visitor will (fields, spam
  placeholder, send button), updating live as they change settings.
- An author can **configure** the form without touching code: form name, subject field
  on/off, which fields are required, and the success message.
- Submissions stay correctly attributed: each form instance has a **stable `formId`** the
  author never has to manage, so two contact forms never silently collide in the inbox.
- The block round-trips losslessly through Markdoc (edit → save → reopen is identical), and
  the site renders exactly what the preview showed.

## Non-Goals (deferred — mostly the pro "form builder")

- Arbitrary custom fields / adding-removing-reordering fields.
- Per-field **label and placeholder** editing (deferred this slice).
- Multiple form *types*, multi-step, conditional logic.
- Any change to site rendering, the submission pipeline, email, or the inbox.

## Architecture

A new Tiptap node-view `contactBlock`, mirroring `apps/admin/src/editor/extensions/Callout.tsx`
and `ImageBlock.tsx`:

```
{% contact formId formLabel subject nameRequired subjectRequired successMessage %}
        │  (Markdoc → Tiptap, routed by registry.knownBlockTags)
        ▼
  contactBlock node-view  ──renders──►  live static preview (fields reflect attrs)
        │                              gear → "Form settings" popover
        │  updateAttributes({ mdAttrs })
        ▼
  Tiptap doc ──serialize──► {% contact ... %}  (unchanged site render in contact.astro)
```

Wiring (same three hooks `image` uses):
1. Register `contactBlock` in the canvas extensions list (`Canvas.tsx`).
2. `registry.knownBlockTags.add('contact')` (`apps/admin/src/blocks/registry.ts`) so the
   Markdoc↔Tiptap converter routes `{% contact %}` to this node, not the generic `setuBlock`.
3. The slash-menu insertion path inserts a `contactBlock` node (with freshly-generated
   `formId` + sensible defaults) instead of a generic `setuBlock`.

## Components

### 1. `contactBlock` node-view (`apps/admin/src/editor/extensions/ContactBlock.tsx`)

- A Tiptap `Node` (atom-ish; the form has no editable body — unlike callout which has a
  slot). Attributes carried on the node: `mdAttrs` (the block's Markdoc attributes) — same
  envelope callout uses.
- Renders the preview + the settings popover trigger. Writes changes via
  `updateAttributes({ mdAttrs: next })`.

### 2. Live static preview

Pure, derived entirely from the current attrs:
- Disabled, labeled inputs for **Name**, **Email**, **Subject** (only when `subject` is on),
  **Message**. Required fields show a `*`.
- A **"Spam protection"** placeholder block (a bordered box labeled e.g. "Spam protection
  (Cloudflare Turnstile)") — we do **not** load the Turnstile script in the editor.
- A disabled **Send** button.
- Visual style consistent with the admin (shadcn tokens); clearly non-interactive (inputs
  disabled, `contentEditable={false}` on the chrome).

The field list + required markers come from a **pure helper** (`contactPreviewFields(attrs)`)
so it's unit-testable and shared by node + tests.

### 3. "Form settings" popover (shadcn `Popover`)

Triggered by a gear button on the block header. Fields:
- **Form name** (text input) → `formLabel`. Used to group + label submissions in the inbox.
- **Subject field** (switch) → `subject`.
- **Required fields**: **Email** shown as a locked/always-on indicator; **Name** (switch →
  `nameRequired`); **Subject** (switch → `subjectRequired`, shown only when subject is on).
  Message is always required (`messageRequired` stays `true`, not exposed).
- **Success message** (text input/textarea) → `successMessage`.

All edits call `updateAttributes`, so the preview updates live and the change persists to
Markdoc.

### 4. `formId` auto-management (pure helper)

- `ensureFormId(attrs)` returns attrs with a `formId` — generating a stable short id
  (e.g. `contact-<8 hex>`, via `crypto.randomUUID().slice(...)`) when absent, otherwise
  leaving the existing one untouched.
- Called on **insert** (slash menu) and defensively on **first edit** of a block that lacks
  one (back-compat with hand-authored `{% contact %}` or pre-this-slice inserts).
- The author never sees or edits `formId` directly; renaming **Form name** changes only
  `formLabel`, so the inbox grouping/attribution is stable across renames.

## Data flow / round-trip

- Attributes match the block's existing Zod contract (`blocks/contact/block.ts`): `formId`,
  `formLabel`, `subject`, `nameRequired`, `subjectRequired`, `messageRequired`,
  `successMessage`. The node neither adds nor renames attributes — it just provides a good UI
  over them.
- Markdoc serialization is the existing folder-block path; this node uses the same `mdAttrs`
  envelope as callout, so the round-trip machinery is unchanged.
- Defaults on insert: `subject: false`, `nameRequired: true`, `subjectRequired: false`,
  `messageRequired: true`, `successMessage` = the block's default, `formLabel` = "Contact"
  (editable), `formId` = generated.

## Error handling / edge cases

- **Missing `formId`** (older/hand-authored block) → generated + persisted on first
  interaction; no user action needed.
- **Boolean attrs arriving as strings** from Markdoc (`"true"`/`"false"`) → normalized by a
  pure coercion helper so the switches reflect the actual state. (Verify against how callout
  reads its `mdAttrs`.)
- **Subject toggled off** while `subjectRequired` was on → `subjectRequired` is irrelevant
  (the field isn't shown); leave the stored value but don't surface the toggle.
- Preview is read-only; no submit/Turnstile in the editor, so no network or spam concerns.

## Testing

- **Pure helpers (unit):** `contactPreviewFields(attrs)` (correct fields + required markers
  for representative attr combinations, incl. subject on/off), `ensureFormId` (generates when
  absent, preserves when present), boolean coercion.
- **Round-trip:** a contact block with non-default attrs serialized to Markdoc and parsed
  back yields identical attrs (mirror any existing callout round-trip test).
- **Editor node:** if the admin editor test harness covers callout-style node-views, add an
  analogous test (insert → preview reflects defaults → toggle subject updates preview →
  attrs persist). Otherwise this is covered by manual UAT (insert block, open settings,
  toggle subject, set name + success message, save, reopen, confirm site render matches).

## Rollout / dependencies

- Stacked on `forms-basic` (needs the contact block + its Zod contract). When PR #39 merges,
  rebase this branch onto `main`.
- Admin-only change set: new editor extension + registry/canvas wiring + slash-menu insert +
  pure helpers (some helpers may live in `@setu/core` if shared with the site, else in admin).
  No site/api/core-pipeline changes.

## Open questions (resolve during planning)

- **O1 — node shape:** atom node vs. a node with an (unused) body slot. Leaning atom (the
  form has no author-editable content); confirm against how the Tiptap schema + Markdoc
  converter expect folder blocks (callout has a body; contact does not).
- **O2 — helper placement:** `contactPreviewFields` / `ensureFormId` / coercion in
  `@setu/core` (if any reuse with the site/island is plausible) vs. admin-local. Leaning
  admin-local unless reuse is concrete (YAGNI).
- **O3 — popover vs. inline for the *first* setup:** whether to auto-open the settings
  popover once on insert (so the author immediately names the form) or leave it closed with a
  visible "Form settings" affordance. Leaning auto-open-once for a smoother first run.

## Decisions log (from brainstorm)

- Authoring model: **dedicated node + live static preview + "Form settings" popover**;
  `formId` auto-managed. **(A)**
- Required toggles exposed: **Name + Subject** only (Email & Message always required).
- Per-field label/placeholder editing: **deferred**.
- Site/pipeline/inbox: **unchanged**.
