# Settings: Content & Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Content & Reading settings group — configurable homepage, search-engine visibility, and admin listing page size — on the existing Git-backed settings spine, plus the feed/markdown switches in the schema for later increments.

**Architecture:** Extend the core `SiteSettings` schema with a `reading` group (defaults + deep-merge, preserving unknown groups). Generalize the admin's `SiteTitleProvider` into a `SettingsProvider` that reads the whole settings object. A Reading form (mirroring `GeneralSettings`) commits the group via `git.commitFile`; the site consumes homepage + search-visibility, the admin consumes the page size.

**Tech Stack:** TypeScript (strict), Zod, React 19 + shadcn/ui, Astro, Vitest, the existing `GitPort` + content index.

## Global Constraints

- TS strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (use `import type`), `isolatedModules`.
- Settings persist in the Git-backed `settings.json` (content-repo root); saves **preserve unknown future groups** (`{ ...raw, reading }`); reads never throw (malformed/missing → defaults).
- The grouped schema is `{ general, reading }`; `reading` carries `homepage`, `searchEngineVisible`, `listPageSize`, **`feed { enabled, items }`**, **`markdown { mode, style }`** — feed/markdown are **schema-only this increment** (no form controls, no output).
- Defaults: `reading = { homepage: 'page/en/home', searchEngineVisible: true, listPageSize: 25, feed: { enabled: false, items: 20 }, markdown: { mode: 'off', style: 'raw' } }`.
- Homepage is a Select of existing **pages** (`collection: 'page'`) from the content index; page-size options `10/25/50/100`; robots `noindex, nofollow` when search-visibility is discouraged.
- Admin commit author: `OWNER_AUTHOR` (from `apps/admin/src/data/store.tsx`).
- TDD; conventional commits ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Core — add the `reading` settings group

**Files:**
- Modify: `packages/core/src/settings/types.ts`, `defaults.ts`, `schema.ts`
- Modify: `packages/core/src/index.ts` (export `ReadingSettings`)
- Modify: `packages/core/test/settings/parse.test.ts`

**Interfaces:**
- Produces: `ReadingSettings`; `SiteSettings` gains `reading: ReadingSettings`; `DEFAULT_SETTINGS.reading`; `parseSettings` fills the `reading` group.

- [ ] **Step 1: Add the failing tests**

Append to `packages/core/test/settings/parse.test.ts` (inside the existing `describe('parseSettings', ...)`):

```typescript
  it('fills the reading group from defaults when absent', () => {
    const out = parseSettings({ general: { title: 'X' } })
    expect(out.reading).toEqual(DEFAULT_SETTINGS.reading)
  })

  it('deep-merges a partial reading group (incl. nested feed/markdown)', () => {
    const out = parseSettings({ reading: { homepage: 'page/en/about', feed: { enabled: true } } })
    expect(out.reading.homepage).toBe('page/en/about')
    expect(out.reading.searchEngineVisible).toBe(DEFAULT_SETTINGS.reading.searchEngineVisible)
    expect(out.reading.feed).toEqual({ enabled: true, items: DEFAULT_SETTINGS.reading.feed.items })
    expect(out.reading.markdown).toEqual(DEFAULT_SETTINGS.reading.markdown)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @setu/core test -- settings/parse`
Expected: FAIL — `out.reading` is undefined.

- [ ] **Step 3: Extend the types**

In `packages/core/src/settings/types.ts`, add `ReadingSettings` and the `reading` field:

```typescript
export interface ReadingSettings {
  /** Entry id served at '/', e.g. 'page/en/home'. */
  homepage: string
  /** false → emit a noindex robots meta. */
  searchEngineVisible: boolean
  /** Admin content-list page size. */
  listPageSize: number
  /** RSS feed config — consumed by a later increment. */
  feed: { enabled: boolean; items: number }
  /** Markdown / llms.txt output — consumed by a later increment. */
  markdown: { mode: 'off' | 'index' | 'pages'; style: 'raw' | 'rendered' }
}

export interface SiteSettings {
  general: GeneralSettings
  reading: ReadingSettings
}
```

- [ ] **Step 4: Extend the defaults**

In `packages/core/src/settings/defaults.ts`:

```typescript
export const DEFAULT_SETTINGS: SiteSettings = {
  general: {
    title: 'Setu',
    tagline: '',
    description: '',
    timezone: 'UTC',
    dateFormat: 'MMM D, YYYY',
  },
  reading: {
    homepage: 'page/en/home',
    searchEngineVisible: true,
    listPageSize: 25,
    feed: { enabled: false, items: 20 },
    markdown: { mode: 'off', style: 'raw' },
  },
}
```

- [ ] **Step 5: Extend the schema + merge**

In `packages/core/src/settings/schema.ts`, add a `reading` schema and deep-merge it in `parseSettings`:

```typescript
const readingSchema = z
  .object({
    homepage: z.string(),
    searchEngineVisible: z.boolean(),
    listPageSize: z.number(),
    feed: z.object({ enabled: z.boolean(), items: z.number() }).partial(),
    markdown: z
      .object({ mode: z.enum(['off', 'index', 'pages']), style: z.enum(['raw', 'rendered']) })
      .partial(),
  })
  .partial()

// add `reading` to the existing settingsSchema object (keep .passthrough()):
const settingsSchema = z
  .object({ general: generalSchema.optional(), reading: readingSchema.optional() })
  .passthrough()
```

Then in `parseSettings`, merge `reading` (with nested feed/markdown) over defaults:

```typescript
export function parseSettings(raw: unknown): SiteSettings {
  const parsed = settingsSchema.safeParse(raw)
  const data: Record<string, unknown> = parsed.success ? parsed.data : {}
  const general = (data.general ?? {}) as Partial<SiteSettings['general']>
  const reading = (data.reading ?? {}) as Partial<SiteSettings['reading']>
  const rd = DEFAULT_SETTINGS.reading
  return {
    ...data,
    general: { ...DEFAULT_SETTINGS.general, ...general },
    reading: {
      ...rd,
      ...reading,
      feed: { ...rd.feed, ...(reading.feed ?? {}) },
      markdown: { ...rd.markdown, ...(reading.markdown ?? {}) },
    },
  } as SiteSettings
}
```

- [ ] **Step 6: Export the type**

In `packages/core/src/index.ts`, add `ReadingSettings` to the settings type export line:

```typescript
export type { SiteSettings, GeneralSettings, ReadingSettings } from './settings/types'
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @setu/core test -- settings/parse`
Expected: PASS (existing + 2 new). Existing tests (general/unknown-groups) still pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/settings packages/core/test/settings/parse.test.ts packages/core/src/index.ts
git commit -m "feat(core): add reading settings group to SiteSettings"
```

---

## Task 2: Admin SettingsProvider (generalize SiteTitleProvider)

**Files:**
- Create: `apps/admin/src/data/settings-store.tsx`
- Delete: `apps/admin/src/shell/site-title.tsx`
- Modify: `apps/admin/src/main.tsx`, `apps/admin/src/shell/PageHeader.tsx`, `apps/admin/src/screens/settings/GeneralSettings.tsx` (import paths + provider name)

**Interfaces:**
- Consumes: `parseSettings`/`DEFAULT_SETTINGS`/`SiteSettings` (core), `useServices().git`.
- Produces: `SettingsProvider`, `useSettings(): SiteSettings`, `useRefreshSettings(): () => void`, and the back-compat `useSiteTitle()`/`useRefreshSiteTitle()`.

- [ ] **Step 1: Create the generalized store**

```tsx
// apps/admin/src/data/settings-store.tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { parseSettings, DEFAULT_SETTINGS, type SiteSettings } from '@setu/core'
import { useServices } from './store'

interface SettingsApi {
  settings: SiteSettings
  refresh: () => void
}

const SettingsContext = createContext<SettingsApi>({ settings: DEFAULT_SETTINGS, refresh: () => {} })

/** Reads the Git-backed settings.json once so the admin can consume site settings
 *  (document title, list page size, future groups). Defaults until loaded. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { git } = useServices()
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS)

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const raw = await git.readFile('settings.json')
        setSettings(parseSettings(raw ? (JSON.parse(raw) as unknown) : undefined))
      } catch {
        setSettings(DEFAULT_SETTINGS)
      }
    })()
  }, [git])

  useEffect(() => refresh(), [refresh])

  return <SettingsContext.Provider value={{ settings, refresh }}>{children}</SettingsContext.Provider>
}

export const useSettings = (): SiteSettings => useContext(SettingsContext).settings
export const useRefreshSettings = (): (() => void) => useContext(SettingsContext).refresh

// Back-compat (the document-title API from PR #46), now derived from full settings.
export const useSiteTitle = (): string => useSettings().general.title
export const useRefreshSiteTitle = (): (() => void) => useRefreshSettings()
```

- [ ] **Step 2: Delete the old file + update the importers**

```bash
git rm apps/admin/src/shell/site-title.tsx
```

- `apps/admin/src/main.tsx`: change the import `import { SiteTitleProvider } from './shell/site-title'` → `import { SettingsProvider } from './data/settings-store'`, and replace the `<SiteTitleProvider>...</SiteTitleProvider>` wrapper (around `<App />`) with `<SettingsProvider>...</SettingsProvider>`.
- `apps/admin/src/shell/PageHeader.tsx`: change `import { useSiteTitle } from './site-title'` → `import { useSiteTitle } from '../data/settings-store'`. (Usage unchanged.)
- `apps/admin/src/screens/settings/GeneralSettings.tsx`: change `import { useRefreshSiteTitle } from '../../shell/site-title'` → `import { useRefreshSiteTitle } from '../../data/settings-store'`. (Usage unchanged.)

- [ ] **Step 3: Typecheck + run the admin tests**

Run: `pnpm --filter @setu/admin typecheck`
Run: `pnpm --filter @setu/admin test -- general-settings`
Expected: PASS — the existing General test still works (the `useRefreshSiteTitle` derivation resolves via the context default in tests).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/data/settings-store.tsx apps/admin/src/main.tsx apps/admin/src/shell/PageHeader.tsx apps/admin/src/screens/settings/GeneralSettings.tsx
git commit -m "refactor(admin): generalize SiteTitleProvider into SettingsProvider"
```

---

## Task 3: Reading settings form + activate in the shell

**Files:**
- Create: `apps/admin/src/screens/settings/ReadingSettings.tsx`
- Create: `apps/admin/test/reading-settings.test.tsx`
- Modify: `apps/admin/src/screens/settings/Settings.tsx` (activate the group)

**Interfaces:**
- Consumes: `parseSettings`/`DEFAULT_SETTINGS`/`ReadingSettings` (core), `useServices().git` + `OWNER_AUTHOR`, `useRefreshSettings` (Task 2), `useIndex`, `useNotify`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/reading-settings.test.tsx
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { ReadingSettings } from '../src/screens/settings/ReadingSettings'

afterEach(() => localStorage.clear())

function renderReading() {
  const git = createMemoryGitPort([])
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  render(wrapper(<ReadingSettings />))
  return { git }
}

describe('ReadingSettings', () => {
  it('toggles search-engine visibility and commits the reading group', async () => {
    const { git } = renderReading()
    const toggle = await screen.findByLabelText(/discourage search engines/i)
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).reading.searchEngineVisible).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- reading-settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Reading form**

```tsx
// apps/admin/src/screens/settings/ReadingSettings.tsx
import { useEffect, useState } from 'react'
import { parseSettings, DEFAULT_SETTINGS, type ReadingSettings as ReadingValues } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../../data/store'
import { useRefreshSettings } from '../../data/settings-store'
import { useIndex } from '../../data/index-store'
import { useNotify } from '../../ui/notify'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

const SETTINGS_PATH = 'settings.json'
const PAGE_SIZES = [10, 25, 50, 100]

const sameReading = (a: ReadingValues, b: ReadingValues) =>
  a.homepage === b.homepage &&
  a.searchEngineVisible === b.searchEngineVisible &&
  a.listPageSize === b.listPageSize

export function ReadingSettings() {
  const { git } = useServices()
  const notify = useNotify()
  const refreshSettings = useRefreshSettings()
  const index = useIndex()
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null)
  const [values, setValues] = useState<ReadingValues>(DEFAULT_SETTINGS.reading)
  const [published, setPublished] = useState<ReadingValues | null>(null)
  const [saving, setSaving] = useState(false)
  const [pages, setPages] = useState<{ id: string; title: string }[]>([])

  useEffect(() => {
    let live = true
    void (async () => {
      const content = await git.readFile(SETTINGS_PATH)
      let parsedRaw: Record<string, unknown> = {}
      try {
        parsedRaw = content ? (JSON.parse(content) as Record<string, unknown>) : {}
      } catch {
        parsedRaw = {}
      }
      const reading = parseSettings(parsedRaw).reading
      if (live) {
        setRaw(parsedRaw)
        setValues(reading)
        setPublished(reading)
      }
    })()
    return () => {
      live = false
    }
  }, [git])

  useEffect(() => {
    let live = true
    void (async () => {
      await index.ensureBuilt()
      const r = await index.query({
        collection: 'page',
        offset: 0,
        limit: 1000,
        sort: { key: 'title', dir: 'asc' },
      })
      if (live) {
        setPages(r.rows.map((row) => ({ id: `${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`, title: row.title })))
      }
    })()
    return () => {
      live = false
    }
  }, [index])

  const dirty = published !== null && !sameReading(values, published)
  const set = (patch: Partial<ReadingValues>) => setValues((v) => ({ ...v, ...patch }))

  const save = async () => {
    if (saving || !dirty || raw === null) return
    setSaving(true)
    try {
      const next = { ...raw, reading: values }
      await git.commitFile({
        path: SETTINGS_PATH,
        content: JSON.stringify(next, null, 2) + '\n',
        message: 'chore(settings): update reading settings',
        author: OWNER_AUTHOR,
      })
      setRaw(next)
      setPublished(values)
      notify.success('Settings saved')
      refreshSettings()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // Ensure the current homepage value is always selectable, even if it isn't a page.
  const homepageOptions = pages.some((p) => p.id === values.homepage)
    ? pages
    : [{ id: values.homepage, title: values.homepage }, ...pages]

  return (
    <div className="max-w-xl space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="rd-home">Homepage</Label>
        <Select value={values.homepage} onValueChange={(v) => set({ homepage: v })}>
          <SelectTrigger id="rd-home">
            <SelectValue placeholder="Choose a page" />
          </SelectTrigger>
          <SelectContent>
            {homepageOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title || p.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">The page shown at your site root (/).</p>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="rd-noindex">Discourage search engines from indexing</Label>
        <Switch
          id="rd-noindex"
          checked={!values.searchEngineVisible}
          onCheckedChange={(c) => set({ searchEngineVisible: !c })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rd-size">Items per page (content lists)</Label>
        <Select
          value={String(values.listPageSize)}
          onValueChange={(v) => set({ listPageSize: Number(v) })}
        >
          <SelectTrigger id="rd-size" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[values.listPageSize, ...PAGE_SIZES.filter((s) => s !== values.listPageSize)]
              .sort((a, b) => a - b)
              .map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={() => void save()} disabled={published === null || !dirty || saving}>
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </Button>
    </div>
  )
}
```

> Verify the `IndexQuery` `sort` shape against `ContentList.tsx` (`sort: { key: 'title', dir: 'asc' }`) and the `useIndex` import path (`../../data/index-store`) — match the real ones.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/admin test -- reading-settings`
Expected: PASS.

- [ ] **Step 5: Activate the group in the shell**

In `apps/admin/src/screens/settings/Settings.tsx`:
- import `ReadingSettings`: `import { ReadingSettings } from './ReadingSettings'`.
- add `'reading'` to the `GroupId` type and the `GROUPS` array: `{ id: 'reading', label: 'Content & Reading' }` (between General and Forms).
- remove `'Content & Reading'` from the `COMING_SOON` array.
- render it in the active-group switch: `active === 'reading' ? <ReadingSettings /> : ...` (extend the existing conditional, e.g. `active === 'general' ? <GeneralSettings /> : active === 'reading' ? <ReadingSettings /> : <FormsGroup />`).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @setu/admin typecheck`

```bash
git add apps/admin/src/screens/settings/ReadingSettings.tsx apps/admin/test/reading-settings.test.tsx apps/admin/src/screens/settings/Settings.tsx
git commit -m "feat(admin): Content & Reading settings form + activate in shell"
```

---

## Task 4: Consume the settings (site homepage + robots; admin page size)

**Files:**
- Modify: `apps/site/src/pages/index.astro`, `apps/site/src/pages/[...path].astro`
- Modify: `packages/theme-default/Layout.astro`
- Modify: `apps/admin/src/screens/ContentList.tsx`

**Interfaces:**
- Consumes: `loadSiteSettings().reading` (site), `useSettings().reading.listPageSize` (admin, Task 2).

- [ ] **Step 1: Homepage — `index.astro`**

Replace the hardcoded home entry with the configured one (+ fallback). New `apps/site/src/pages/index.astro`:

```astro
---
import PageLayout from '@theme/PageLayout.astro'
import { getEntry, render } from 'astro:content'
import { loadThemeOptions } from '../lib/site-config'
import { loadSiteSettings } from '../lib/site-settings'

const themeOptions = loadThemeOptions()
const siteSettings = loadSiteSettings()
const homepageId = siteSettings.reading.homepage
const entry = (await getEntry('entries', homepageId)) ?? (await getEntry('entries', 'page/en/home'))
const title = entry ? ((entry.data as { title?: string }).title ?? 'Home') : 'Home'
const rendered = entry ? await render(entry) : null
const Content = rendered?.Content
---

<PageLayout title={title} lang="en" themeOptions={themeOptions} siteSettings={siteSettings}>
  {Content ? (
    <>
      <h1>{title}</h1>
      <Content />
    </>
  ) : (
    <p>No homepage is configured yet.</p>
  )}
</PageLayout>
```

- [ ] **Step 2: Exclude the configured homepage — `[...path].astro`**

In `apps/site/src/pages/[...path].astro`, change `getStaticPaths` to exclude the configured homepage (and keep excluding the conventional `page/en/home` so a fallback home never double-routes):

```astro
export async function getStaticPaths() {
  const all = await getCollection('entries')
  const homepage = loadSiteSettings().reading.homepage
  return all
    .filter((entry) => entry.id !== homepage && entry.id !== 'page/en/home')
    .map((entry) => ({ params: { path: toUrlPath(entry.id) }, props: { entry } }))
}
```

(`loadSiteSettings` is already imported in this file.)

- [ ] **Step 3: Robots meta — `Layout.astro`**

In `packages/theme-default/Layout.astro`, add a robots meta in `<head>` right after the description meta, when search-engine visibility is discouraged:

```astro
    {description && <meta name="description" content={description} />}
    {siteSettings?.reading.searchEngineVisible === false && (
      <meta name="robots" content="noindex, nofollow" />
    )}
```

(`siteSettings` is already a `Prop` on Layout; it now carries `reading`.)

- [ ] **Step 4: Admin page size — `ContentList.tsx`**

In `apps/admin/src/screens/ContentList.tsx`:
- add the import: `import { useSettings } from '../data/settings-store'`.
- remove the module constant `const PAGE_SIZE = 25`.
- inside the `ContentList` component (near the other hooks), add: `const pageSize = useSettings().reading.listPageSize`.
- replace every `PAGE_SIZE` reference inside the component with `pageSize` (the query `offset: page * pageSize, limit: pageSize`, and any `from`/`to` pager math).
- add `pageSize` to the query `useEffect` dependency array.
- reset the page when the size changes: add `useEffect(() => setPage(0), [pageSize])`.

- [ ] **Step 5: Verify (site build + admin typecheck/tests)**

Run: `pnpm --filter @setu/site exec astro sync` then `pnpm --filter @setu/site build`
Expected: build succeeds (homepage resolves; robots meta compiles).
Run: `pnpm --filter @setu/admin typecheck` and `pnpm --filter @setu/admin test`
Expected: PASS (ContentList still green with the dynamic page size).

- [ ] **Step 6: UAT**

With the dev stack: `/settings` → Content & Reading → pick a different page as homepage + toggle "discourage search engines" + change items-per-page → Save. Then: the site serves the chosen page at `/`; view-source shows the robots meta when discouraged; the admin content lists paginate at the chosen size.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/pages/index.astro 'apps/site/src/pages/[...path].astro' packages/theme-default/Layout.astro apps/admin/src/screens/ContentList.tsx
git commit -m "feat: consume reading settings (homepage, robots, admin page size)"
```

**Final:** request a whole-branch review (`superpowers:requesting-code-review`), then `superpowers:finishing-a-development-branch`.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**
- `reading` group in schema (homepage, searchEngineVisible, listPageSize, feed, markdown) + defaults + merge + preserve-unknown → Task 1. ✅
- Admin SettingsProvider generalizing SiteTitleProvider → Task 2. ✅
- Reading form (homepage page-Select, search-vis Switch, page-size Select) + shell activation → Task 3. ✅
- Homepage consumed by site (+ fallback); searchEngineVisible → robots; listPageSize → admin lists → Task 4. ✅
- Feed/markdown schema-only (no controls/output) → Task 1 (schema), not surfaced anywhere else. ✅

**2. Placeholder scan:** No TBD/TODO; code steps carry complete code. The two prose-edit steps (ContentList PAGE_SIZE→pageSize; shell activation) name exact symbols + the verify-against grep, with the surrounding code already shown in this plan/the extracted patterns.

**3. Type consistency:** `ReadingSettings` (+ nested `feed`/`markdown`), `DEFAULT_SETTINGS.reading`, `parseSettings`, `useSettings`/`useRefreshSettings`, `useSiteTitle`/`useRefreshSiteTitle`, `settings.json` path, `OWNER_AUTHOR`, and `git.commitFile({ path, content, message, author })` are consistent across Tasks 1–4. Homepage id format `collection/locale/slug` matches the index `ContentRow.ref`.

**Open questions:** all resolved in the spec (O1 pages-only + blog-archive roadmapped; O2 admin page size `10/25/50/100`; O3 `noindex, nofollow`).
