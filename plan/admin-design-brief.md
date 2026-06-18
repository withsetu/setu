# Setu Admin — Design Brief

> A brief for **Claude Design** to generate a modern CMS admin. Scope: the **free tier**. Paste this in, optionally with screenshots of the reference products below.

---

## What we're building

**Setu** is an open-source, Git-backed CMS. We need a beautiful, modern **admin** — the place where non-technical marketers and writers create, edit, and publish website content. Think "what WordPress's admin should have been in 2026."

The single most important screen is **the editor**. Design it to be exceptional; everything else supports it.

---

## North-star philosophy: writer-first & distraction-free

The guiding principle: **everything hides, and you just write.**

- The editor is a calm, full-bleed canvas. No permanent panels crowding the page.
- Chrome (toolbars, metadata, settings) **fades away while writing** and is **summoned on demand** (slide-overs, a `/` command menu), not parked on screen.
- Fast, quiet, confident. Generous whitespace. Content is the hero.
- Familiar enough that a WordPress user feels at home instantly — but it feels modern, not cluttered.

**Steal liberally from these** (great references to attach):
- **Ghost editor** & **Medium** — full-bleed, zero-chrome writing.
- **iA Writer / Typora** — focus mode; the UI disappears.
- **Notion** — `/` slash menu for everything; settings tucked into slide-overs.
- **Linear** — overall polish, speed, keyboard-first feel.
- **Gutenberg fullscreen/spotlight mode** — block highlighting, immersive editing.

---

## Visual language

- **Aesthetic:** minimal, modern, calm — Notion/Linear level of polish.
- **Light AND dark mode**, both first-class.
- **Type:** a clean sans for the UI; for the writing canvas, explore a comfortable reading face (a refined sans or a humanist serif) — generous size and line-height.
- **Color:** restrained neutral base, **one confident accent**. Subtle borders, soft shadows, gentle rounded corners.
- **Motion:** subtle and purposeful (fades, slide-overs), never flashy.
- **Build target (for handoff):** React + Tailwind + shadcn/ui (Radix primitives). **Accessible: WCAG 2.1 AA**, keyboard-first, visible focus states.

---

## Global shell

- **Left sidebar nav** (collapsible, unobtrusive): Dashboard · Content (Posts / Pages / custom types) · Media · Forms · Site · Settings.
- A small **topology indicator** at the bottom (e.g. "Local · Tunnel") — informational.
- **Pro features appear as tasteful locked entry points** — a subtle "Pro" chip + gentle upsell, never hidden (discovery matters). Please design these lock states; see "Out of scope" for the list.

---

## Screens to design

### 1. The Editor — *the priority, make it sing*

Writer-first, distraction-free:
- **Full-bleed canvas**: a large title, then the body. Nothing else competing by default.
- **Slash menu** (`/`): the primary way to insert blocks (headings, lists, quote, image, callout, etc.). Clean, searchable, keyboard-navigable.
- **Block affordances on hover**: a drag handle to reorder, a small "+" to add. They appear on hover and vanish otherwise.
- **Focus mode**: while typing, the rest of the UI dims/fades; optionally the active block is spotlighted.
- **A slim, quiet top strip** that's present but understated:
  - A **status pill**: **Draft → Staged → Deployed** (subtle, always knowable).
  - **Autosave** indicator ("Saved").
  - **Presence/lock** ("Sarah is editing" / "🔒 you").
  - **Locale switcher** (EN / FR / …).
  - **Preview** toggle (opens a rendered preview of the page; can split side-by-side).
- **Metadata & settings live in a right slide-over** that is **hidden by default** and summoned via a button. It contains: title, slug, status, author, date, locale, categories/tags, featured image, and an **SEO** group (meta title, meta description, canonical URL, social/OG image), plus an **Advanced** group (raw source view).
- **Blocks:**
  - *Normal blocks* (callout, image, hero, columns…) are editable, with a small contextual **props panel** when selected.
  - *Dynamic/advanced blocks* the marketer can't edit visually are shown as **labeled, read-only "chips"** with a subtle **Pro lock** (e.g. "⚡ Conditional content — Pro"). Design this chip — it should feel intentional, not broken.
- **Images** prompt for **alt text** (accessibility is first-class).

### 2. Dashboard
A calm overview: recent edits, what's currently being edited and by whom, deploy status, and quick actions ("New post", "New page"). Room for simple at-a-glance info.

### 3. Content list (Posts / Pages / custom types)
A fast, filterable table: **Title · Status · Author · Locale · Updated**. A search field, bulk actions, a per-row lock indicator, and a prominent "New" button. Design a clean **empty state**.

### 4. Media library
A visual grid/browser: drag-and-drop upload, search, folders, **inline alt-text editing**, and a reuse picker (select an existing asset). A detail panel per asset. Empty state.

### 5. Forms
A list of forms, and per-form a **submissions inbox** (a table of entries) with an **Export** button. Empty states for "no forms" and "no submissions yet."

### 6. Site (publish & deploy)
- A **shareable preview link**.
- A **"Deploy Live"** action (gated to the Publisher role).
- A **deploy history / status** view: pending · building · live · failed, with a link to logs. Visualize the **Draft → Staged → Deployed** lifecycle clearly.

### 7. Settings
Sectioned, clean forms:
- **Permalinks** — URL structure per content type (with a note that changing it auto-creates redirects).
- **SEO defaults** — sitemap & robots toggles, default meta.
- **Locales / i18n** — add and order site languages.
- **Users & roles** — a table of users with roles **Admin / Publisher / Editor / Viewer**, plus invite.
- **Auth** — sign-in provider.
- **Integrations** — email, image optimization, storage shown as tidy "connect" cards.
- **Analytics** — a single code-snippet field (admin-only).

---

## States & details to design

- **Empty states** for every list (content, media, forms, users).
- **Saving / saved / error** states (e.g. "Publish failed — Retry"; "Deploy building…").
- **The "Pro" locked-feature** treatment (a reusable pattern).
- **Light + dark** for everything.
- **Responsive**: excellent on a laptop; tablet a nice-to-have.

---

## Accessibility (non-negotiable)

WCAG 2.1 AA. Keyboard-first throughout. The slash menu behaves as a combobox/listbox; blocks are keyboard-reorderable; focus states are always visible; color contrast passes.

---

## Out of scope — show as locked "Pro", don't design in full

These are paid features. Represent them only as tasteful **locked entry points** (a "Pro" chip + one-line upsell), so users can discover them:

- Visual builders for dynamic content (conditionals, variables, loops)
- Visual content-type / custom-field builder
- Redirect manager UI; SEO scoring/suggestions
- Translation-management workspace
- Version history & rollback UI
- Scheduled publishing; shareable draft-preview links
- Editorial review/approval workflow
- Real-time collaboration; path-scoped roles & audit log

---

## What we'd love back

1. **The editor screen** (writer-first, focus mode) — the centerpiece.
2. The **6 other screens** above.
3. **Light + dark**.
4. A small reusable **component/token set**: nav, buttons, inputs, chips/badges, tables, the slide-over, the status pill, the "Pro" lock.

Optimize for *calm, polished, and "I just want to write here."*
