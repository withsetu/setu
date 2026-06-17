# Saytu Render Pipeline & Theme Layer — Vision & Decomposition

> **Status:** north-star + decomposition (NOT an implementation spec). Captures the
> planning session of 2026-06-17. Each sub-project below gets its own spec → plan →
> build cycle. The first concrete action is a de-risking **render spike**, not a spec.

---

## 1. The strategic question we settled first

In an AI-development world, is an elaborate, human-friendly theme layer (visual tweaks,
a "feels like the old days HTML/CSS" ladder, WordPress-grade hand-authoring DX) the right
investment — or is it over-built? Could we instead keep the engine lean and let AI
generate themes/components via good docs / an MCP server?

**The resolution — our scoping discipline from here on:**

- **The render pipeline is non-optional.** Content → HTML is the *publish half* of the
  machine. Without it the editor produces content nobody can ship. We build it regardless
  of AI. Build it **lean**.
- **The elaborate human theme-authoring ergonomics are cut.** The marginal human who
  hand-codes a theme is a shrinking population. We do **not** build a WordPress-grade
  theme-authoring framework as a headline feature. Instead: **ship one excellent default
  theme + a small token layer.** ~80% of users never theme beyond changing a few tokens.
- **Lean/simple and AI-authorable are the same design target, not a tradeoff.** Low-magic,
  convention-over-config, plain files, a clean schema, no hidden runtime coupling are
  *exactly* what make an LLM (and a human, and a marketplace) reliable at generating
  correct output. Simplicity is the substrate, not nostalgia — and it's cheaper to build.
- **AI / MCP is an accelerant, not the identity.** Repositioning the product around "AI
  builds your site" is a trap: that race (v0 / Lovable / Bolt / Cursor / the model makers)
  is commoditizing to zero and we'd be a thin wrapper with no moat. An MCP server that
  exposes the component contract so any AI can scaffold a correct Saytu component is smart
  and on-strategy — but it is a **later layer on a settled contract**, and you cannot build
  it until the contract exists and is stable.

**The moat (unchanged):** a great editor a *content person* uses daily + content that
round-trips through Git and never breaks + a contract guaranteeing a component works in
**both** the editor and the site. No one owns that combination: WordPress (no AI, heavy),
Keystatic/Tina (dev-only, weak editor), AI site-builders (one-shot, no ongoing content
ops). See [[saytu-wedge]].

**Positioning, one line:** *The AI-native, Git-backed CMS where content people run the
site, AI extends it, and nothing ever gets lost.* AI is a power tool inside the system.

---

## 2. The component model — "write once"

A "component" (block) must exist in **three planes** to work end-to-end:

1. **Editor** — the in-browser React node view (edit affordances, attr panel, slash entry).
2. **Round-trip** — `@saytu/core` knows the Markdoc tag and round-trips its attrs safely
   (the content-safety cardinal rule).
3. **Render** — published HTML on the site.

The callout already lives in planes 1 + 2. The render plane (3) is the only missing one.

**The "write once" decision (owner, firm):** an author writes **one React component =
the visual core**, and never edits it in two places. It gets two thin shells the author
does **not** write — an **editor shell** (Tiptap node view wrapper) and a **site shell**
(a generated `.astro` wrapper). The shells are machinery we generate from the contract.

**A component is a folder, not a central-config entry** (convention over configuration):

```
components/PricingTable/
  PricingTable.tsx   ← the ONE thing the author writes (a React visual core)
  component.ts       ← the contract: tag name, attrs (zod), editor meta (icon/label/variants)
  styles.css         ← optional default styles (themeless-safe)
```

Drop the folder in → on build, codegen reads `component.ts` (the **single source of
truth**) and **fans it out** to all three planes: registers the editor node + slash entry,
teaches `@saytu/core` the tag + round-trip, and generates the `.astro` wrapper +
`markdoc.config` wiring. **One declaration, three planes, no drift** — drift is the bug
that rots these systems, and this designs it out. One typed shape means the `.astro` props,
the editor attrs, and the round-trip can't disagree at compile time.

**Honest boundary:** auto-registration is live for the *render* side (Astro/Vite glob +
HMR in local dev). The *editor* is a separate browser bundle, so a brand-new custom
component needs a build/codegen step there, not literally zero-config-at-runtime (in the
hosted/in-browser-only mode). Local dev can feel instant.

---

## 3. The theme layer — lean, default-first

A **theme** styles and arranges; it does **not** define components. The discipline that
keeps the two add-on types (components vs themes) separable: **every component ships
sensible default markup + minimal styles, so it renders fine with no theme at all.**
Theming is then purely additive — a ladder you climb only as far as you care to:

- **Rung 0 — tokens, no files.** A visual panel in the admin (the existing
  `design/admin/tweaks-panel.jsx`) edits tokens: brand color, fonts, spacing. A non-coder
  makes the site theirs without opening anything. This is where most users stop.
- **Rung 1 — edit the HTML.** `header.astro` / `footer.astro` / `layout.astro` are **plain
  HTML** with a `<slot/>` for content (the `the_content()` equivalent) + occasional
  `{site.title}`. Known filenames auto-wire (a WordPress-style template hierarchy). Astro's
  `<style>` is **auto-scoped**, so a theme author writes naive CSS without specificity wars.
  `astro dev` gives edit → save → refresh. No build in their head.
- **Rung 2 — restyle/restructure a block.** Recolor via CSS, or override a block's render
  with a **plain HTML/`.astro` file** that *wins* via the cascade. Crucially, even a heavy
  structural override can be plain HTML — the theme author never edits the block's React.
- **Rung 3 — a new interactive component.** *Now* it's React. The expert basement; the
  HTML/CSS person never has to know it's there.

**Child theme = a thin layer** that declares `extends: <starter>` and ships only the files
it overrides (a token set, a layout, one block's render). Resolution is a plain cascade:
**child → starter → the component's own default.**

**Distribution: two modes, same shape.** A component or theme is *either* a local folder in
the repo *or* an npm package — identical structure. That single fact quietly enables a
future marketplace (`pnpm add @someone/saytu-…`), and contracts are the stability boundary
that makes an ecosystem safe to build on. (Marketplace itself is far-future / out of scope.)

**Decision recorded against my own idea:** we considered inventing a dead-simple
`header.html` + `{{ mustache }}` dialect so theme authors never meet `.astro` syntax.
**Rejected for now** — inventing a templating language is a permanent tax for a tiny gap
when `.astro` is already ~95% plain HTML. Make `.astro` *feel* like HTML via great
scaffolds + docs instead. Reversible if Rung 1 ever proves too scary in practice.

---

## 4. Verified technical keystone (+ what's still unproven)

**Verified (2026-06-17):** `@astrojs/markdoc`'s `component()` only renders `.astro` files
directly, but the supported pattern is a thin `.astro` wrapper that imports a framework
(React) component and renders it — **server-side to static HTML by default** (zero JS), or
with a `client:*` directive when interactivity is needed. So "write once in React" for the
*render* plane is real: the author writes React, we generate the `.astro` wrapper.
(Sources: Astro Markdoc docs; withastro/astro#10418. Minor caveat: tag names with 2+
hyphens have a known `component()` bug — avoid in tag naming.)

**Still unproven — the editor-reuse half:** that the *same* React core renders cleanly
inside a Tiptap node view (selection, contenteditable boundary, attr panel) **and** inside
the generated `.astro` wrapper, sharing one visual core with no drift. We already render
React in node views (the callout), so this is optimistic — but it earns a spike before it
earns a spec.

**Static vs interactive is a first-class component property** — declared in the contract,
flipped as a flag; the author never hand-writes wrappers or `client:*` directives.

---

## 5. Decomposition — five sub-projects, dependency order

1. **Content render (the engine).** A post's `.mdoc` body → HTML, mapping every shipped
   block (callout, table, checklist, code, align, sub/sup, the never-drop passthrough) to
   real markup. Topology-aware later (SSG reads Git; SSR reads DB index) but
   component/theme resolution stays topology-agnostic. **The keystone; build lean.**
2. **The block component package.** The shipped block renderers, packaged as a clean,
   themeable library (one React core + generated shells per block). Generalizes the callout.
3. **The theme = site layer.** Default theme: layouts, header/footer/nav, global tokens,
   typography. The token (Rung 0) + template (Rung 1) + cascade/child-theme model.
4. **Custom / complex components.** The full author pipeline: `component.ts` contract +
   folder → codegen fans to editor + round-trip + render. Generalizes plane-1/2/3 wiring.
5. **Preview.** Draft preview *inside the editor*, rendered through the same theme +
   components, iframed (per the topology/publishing note: an SSR draft-preview route, not
   the Astro Container API).

Dependency line: **#1 is the foundation. #2 packages it. #3 wraps it. #4 generalizes the
pipeline. #5 reuses #1 + #3.**

**Explicitly deferred / out of scope (anti-creep):** the MCP server, the marketplace,
the homegrown template dialect, a WordPress-grade visual theme builder, multi-topology SSR
render. Revisit only after #1–#3 exist.

---

## 6. Immediate next step — the render spike (NOT a spec yet)

Per Saytu's working pattern (de-risk spike-class risk before speccing), the first action is
a throwaway spike, building on `prototype/astro-preview/`.

**Goal:** prove "one React core, both planes" for a single real block (the callout).

**Success criteria:**
1. A `{% callout %}` Markdoc tag renders through a **React** Callout (via a generated/thin
   `.astro` wrapper) to correct **static HTML** (no client JS unless opted in).
2. Attributes (`type`, `title`) flow from the tag to the React props intact; inline
   markdown inside the callout body renders.
3. (Stretch / reason-about if not coded) the same React core is reusable as the basis of
   the editor node view — confirm the seam, even if just by inspecting the existing
   `apps/saytu-admin` Callout node view rather than fully wiring it.

If it holds, the entire vision above is buildable and sub-project #1 goes to a full spec.
If it fights us, we learn the seam now, cheaply.

---

See [[saytu-project]], [[saytu-wedge]], [[saytu-working-style]], and the topology/publishing
note (`docs/superpowers/specs/2026-06-14-saytu-topology-publishing-note.md`).
