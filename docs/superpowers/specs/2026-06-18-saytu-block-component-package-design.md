# Saytu Block Component Package (sub-project #2) — Design

> Sub-project #2 of the render/theme epic. Parent vision:
> `docs/superpowers/specs/2026-06-17-saytu-render-theme-vision.md`
> (#1 content render ✅ → **#2 block component package** → #3 theme layer → #4
> custom-component pipeline + codegen → #5 preview).

**Goal:** close the "write once" loop for the callout — one shared React visual core,
rendered by *both* the editor and the site, so the duplicate dies and a block can't drift.

**Architecture:** a new `@saytu/blocks` React component package holding the callout's visual
core + its icons + its variant mapping + its CSS (styled via `var(--token, fallback)` so it's
themeless-safe). The editor's Tiptap node view and the site's `.astro` wrapper both render the
core; each injects only its context-specific bits (editor: an editable title input, the body's
`NodeViewContent`, and the tone/icon toolbar; site: static title + rendered body). The editor
node's schema, `mdAttrs`, round-trip, and keyboard nav are **unchanged** — only the visual
markup is re-sourced. Read-only-equivalent on content (no write/round-trip path changes).

**Tech stack:** React 18 · TypeScript (strict, `verbatimModuleSyntax`) · `@saytu/core`
(`resolveConfig`/`defaultConfig` for variants) · consumed by `@saytu/admin` (Vite/Tiptap) and
`@saytu/site` (Astro/Vite). Vitest + Testing Library for the package's unit tests.

---

## 1. Scope

### In scope
- New package **`packages/blocks`** (`@saytu/blocks`) — a React component library:
  - **`Callout` visual core** — renders the structure + classes (`blk-callout tone-{tone}`,
    `callout-head`, `callout-ic`, `callout-body`), with **slots** for the context-specific
    parts (see §3). No editor chrome inside the core.
  - **Block icon set** — the callout icons as inline SVGs + a tiny `<BlockIcon name>` renderer
    + a `BlockIconName` type, so editor and site render the **same** glyph (also fixes the
    hardcoded `💡` left in the site from #1).
  - **Variant mapping** — `variantFor` / `calloutVariants` / `CALLOUT_ICONS` moved here from
    `apps/saytu-admin/src/editor/callout-variants.ts` (reads `@saytu/core`'s `defaultConfig`).
  - **CSS** — `callout.css`: the structural + tone rules, styled via `var(--token, fallback)`
    (e.g. `background: var(--accent-soft, #eef2ff)`), imported by both apps.
- **Editor adoption** (`apps/saytu-admin`): the callout node view renders the shared core,
  injecting the editable title `<input>`, `<NodeViewContent>` body, and the existing tone/icon
  toolbar. Variant logic + block icons now imported from `@saytu/blocks`. The Tiptap **node
  definition (schema, `mdAttrs`, parse/render HTML, keyboard shortcuts) is byte-unchanged**.
- **Site adoption** (`apps/saytu-site`): `CalloutWrapper.astro` renders the shared core; the
  app's own `src/components/Callout.tsx` is deleted; `site.css` callout rules removed (the
  package CSS owns them).
- Tests: package unit tests for the core + variant mapping; the admin's callout + **round-trip
  guard** tests stay green; the site's build-and-assert callout test updated to the unified
  markup.

### Out of scope (named, anti-creep)
- **The token / theme system** (design tokens, dark mode, the cascade) → sub-project **#3**.
  #2 ships CSS with `var(--token, fallback)`; the editor keeps its rich themed look (it has the
  tokens), the site renders the **fallback** look (clean, ~today) until #3 tokenizes it. Pixel
  parity across both is a #3 outcome, not a #2 promise.
- **Other blocks.** Only the **callout** is a custom React component; standard nodes / align /
  sub-sup / checklist / table render via markup + CSS (no React core), so #2 covers the callout
  only. The package is *structured* to hold more, but adds none.
- **Codegen / the contract fan-out** → #4. **Consolidating the admin's full 78-icon `Icon`
  system** → not now (only the ~8 block icons move; the admin's `Icon` stays for app chrome).
- No changes to `@saytu/core` or any content write / Markdoc round-trip path.

---

## 2. Package layout

```
packages/blocks/
  package.json            @saytu/blocks; deps: react (peer), @saytu/core; main -> src/index.ts (TS source, like core)
  tsconfig.json           extends the strict base
  vitest.config.ts        jsdom + testing-library
  src/
    index.ts              barrel: Callout, BlockIcon, BlockIconName, variantFor, calloutVariants, CALLOUT_ICONS, CalloutVariant
    callout/
      Callout.tsx         the visual core (structure + classes + slots)
      variants.ts         variantFor / calloutVariants / CALLOUT_ICONS (reads @saytu/core)
      callout.css         structural + tone CSS, var(--token, fallback)
    icons/
      BlockIcon.tsx       <BlockIcon name> renderer + BlockIconName type
      svgs.ts             the ~8 block-icon SVG paths (info, sparkle, check, alert, zap, pin, lock, settings)
    test/
      callout.test.tsx    renders the core, asserts structure/classes/tone/icon/title-slot/body
      variants.test.ts    variant mapping (config-driven list + neutral fallback)
```

`@saytu/blocks` exports **TS source** (`main`/`exports` → `./src/index.ts`), matching
`@saytu/core`'s convention — consumers (admin Vite, site Astro/Vite) transpile it. **Verified:**
an Astro component can import `@saytu/core` and build to static HTML (spike, 2026-06-18) — so
the `@saytu/blocks` → `@saytu/core` chain works in the site. `react` is a **peerDependency**
(both consumers provide React 18) to avoid a duplicate React.

---

## 3. The `Callout` core — structure & slots

The core owns the **structure + class contract**; consumers inject the context-specific parts.
The class names are the editor's **existing** ones (`blk-callout` / `tone-*` / `callout-head` /
`callout-ic` / `callout-body`) so the editor's CSS + its `:focus-within .block-props` chrome
keep working with minimal churn, and the site adopts them.

```tsx
interface CalloutProps {
  tone: string                 // -> `tone-${tone}` (accent|green|amber|red|slate|neutral)
  icon: BlockIconName          // rendered by the core via <BlockIcon> into the .callout-ic badge
  title?: ReactNode            // SLOT: editor passes <input class="callout-title">; site passes a static title node
  toolbar?: ReactNode          // SLOT: editor passes its .block-props tone/icon toolbar; site passes nothing
  children: ReactNode          // the BODY element: editor passes <NodeViewContent class="callout-body">; site passes <div class="callout-body">…</div>
}
```

Renders (conceptually):
```tsx
<aside className={`blk-callout tone-${tone}`}>
  {toolbar}
  <div className="callout-head">
    <span className="callout-ic"><BlockIcon name={icon} /></span>
    {title}
  </div>
  {children}
</aside>
```

- **Body stays consumer-owned** because `NodeViewContent` must be a Tiptap-managed element — so
  the core places `children` (the body element) rather than wrapping it. (The plan resolves the
  exact Tiptap `NodeViewWrapper` integration; the node's runtime behavior must not change.)
- The core renders the icon itself (from `icon` name) so both sides show the same glyph.
- `tone` and the resolved `icon` come from the variant mapping (`variantFor(type)`), with the
  editor allowing an icon override (as today) — that resolution happens in the consumer and is
  passed in.

---

## 4. Consumer changes

### Editor (`apps/saytu-admin/src/editor/extensions/Callout.tsx`)
- `CalloutView` renders `<Callout tone={variant.tone} icon={icon} title={<input class="callout-title" …/>} toolbar={<div class="block-props" …>…</div>}><NodeViewContent class="callout-body"/></Callout>` (wrapped by `NodeViewWrapper`).
- Imports `variantFor`/`calloutVariants`/`CALLOUT_ICONS` + `BlockIcon` from `@saytu/blocks`;
  `apps/saytu-admin/src/editor/callout-variants.ts` is removed (or becomes a thin re-export if
  other modules import it — check and update those imports).
- The toolbar's tone swatches + icon picker keep their behavior; picker icons render via
  `<BlockIcon>` so they match the rendered badge.
- **Unchanged:** the `Node.create` definition (name/group/content/`defining`/`mdAttrs`
  attribute with `renderHTML:()=>({})`/parseHTML/`renderHTML` div[data-callout]),
  `addKeyboardShortcuts` (ArrowUp→title), the title-input ArrowDown/Enter→body nav, and
  `setAttrs` empty-key hygiene. The round-trip is therefore byte-identical.
- `apps/saytu-admin/src/styles/editor.css`: the structural callout rules
  (`.blk-callout`, `.tone-*` backgrounds, `.callout-head/-ic/-title/-body`) move to the package
  CSS; the **editor-only chrome** (`.block-props`, `.bp-*`, `:focus-within`) stays in editor.css.
  Admin imports `@saytu/blocks`'s `callout.css`.

### Site (`apps/saytu-site`)
- `src/components/CalloutWrapper.astro` renders `<Callout tone={tone} icon={icon} title={title && <span class="callout-title">{title}</span>}><div class="callout-body"><slot/></div></Callout>`, deriving `tone`/`icon` from `variantFor(type)` (imported from `@saytu/blocks`).
- Delete `src/components/Callout.tsx`.
- `src/styles/site.css`: remove the old `.callout` / `.callout--*` / `.callout__*` rules; import `@saytu/blocks`'s `callout.css`.
- Re-add `@saytu/core` is **not** needed directly (it comes transitively via `@saytu/blocks`).

---

## 5. CSS contract — themeless-safe via token fallbacks

`callout.css` uses the admin's existing token names **with fallbacks** so it works with or
without a theme:
```css
.blk-callout.tone-accent { background: var(--accent-soft, #eef2ff); }
.blk-callout.tone-amber  { background: var(--amber-soft,  #fff7ed); }
/* …green/red/neutral/slate similarly; .callout-ic tone colors via var(--accent-strong, …) etc. */
```
- In the **admin**, the tokens are defined (theme-aware, dark mode) → unchanged rich look.
- On the **site** (no tokens yet), the fallbacks apply → clean default look (close to #1's).
- #3 later gives the site the tokens → automatic pixel parity. **No token system is built here.**

---

## 6. Testing

- **`@saytu/blocks` unit tests:** render `<Callout tone icon title toolbar>{body}</Callout>` →
  assert the `aside.blk-callout.tone-{tone}`, the `.callout-ic` badge renders the right icon,
  the title slot + toolbar slot + body children land in the right places. Variant tests:
  `calloutVariants()` reflects the config list; `variantFor` neutral-fallback for unknown types.
- **Admin (unchanged-behavior gate):** the existing callout tests + the **round-trip guard**
  (`tiptapToMarkdoc(getJSON()) === source` for a titled/typed/iconned + a plain callout) must
  stay green — proving the node still round-trips byte-for-byte after the view refactor. Admin
  suite stays at its current count (178), `@saytu/core` at 175.
- **Site:** the build-and-assert callout test updates its expected substrings to the unified
  markup (`blk-callout tone-…`, `callout-ic`, real icon SVG instead of `💡`) and still asserts
  zero-JS.
- **Anti-drift is structural** (both import the same core), confirmed by the package test
  asserting the core's contract.

---

## 7. Success criteria
1. `@saytu/blocks` exists; both apps render the callout through its `Callout` core.
2. The editor callout looks/behaves the same (UAT) and its node round-trips byte-identically
   (guard tests green); the site callout renders via the shared core (no more `Callout.tsx`,
   no hardcoded `💡`).
3. Whole repo green; no `@saytu/core` or write/round-trip changes.
4. Token/theme work, codegen, and other blocks are absent (deferred to #3/#4).

---

## 8. Risks & decisions
- **Touches shipped editor code (content-safety adjacent).** Mitigated: the node *definition*
  is byte-unchanged (only the view's JSX is re-sourced); the round-trip guard is the gate.
- **Class-name contract = the editor's existing names** (reuse, not invent) → minimal admin
  churn + working `:focus-within` chrome; the site adopts them.
- **Minor icon duplication:** the ~8 block-icon SVGs live in `@saytu/blocks` and also remain in
  the admin's 78-entry `Icon` map. Accepted — `@saytu/blocks` is the source of truth for *block*
  icons; the admin `Icon` serves app chrome. (A future consolidation could re-export.)
- **`react` peerDependency** to avoid a duplicate React in either bundle.
- **Site appearance shifts slightly** from #1's neutral look to the token-fallback look — UAT.

---

See [[saytu-project]], the parent vision doc, and
`docs/superpowers/specs/2026-06-17-saytu-render-pipeline-design.md`.
