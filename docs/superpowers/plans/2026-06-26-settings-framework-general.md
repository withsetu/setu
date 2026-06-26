# Settings Framework + General Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Git-backed settings store (`settings.json`) + a grouped `/settings` admin screen + a working General group, wired so the site title/tagline/description stop being hardcoded "Setu".

**Architecture:** A typed `SiteSettings` schema in `@setu/core` (grouped, Zod, defaults + deep-merge); the admin reads/commits `settings.json` at the content-repo root via the same `git.readFile`/`git.commitFile` path Appearance uses; the Astro site reads it at build (mirroring `loadThemeOptions`) and the theme Layout renders the configured values. Secrets never enter this file.

**Tech Stack:** TypeScript (strict), Zod, React 19 + shadcn/ui, Astro, Vitest + @testing-library/react, the existing `GitPort` (memory adapter for tests).

## Global Constraints

- TS strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (use `import type`), `isolatedModules`.
- Settings persist as a **Git-backed `settings.json`** at the **content-repo root** (sibling of `theme-options.json`); written via `git.commitFile`, read on the site from `SETU_CONTENT_DIR/..` (dev) or the repo root. **No secrets in this file** (secrets stay in env).
- The grouped schema shape is `{ general: {...} }` — future groups (`identity`, `content`, `media`, `forms`) slot in without reshaping.
- General fields: `title`, `tagline`, `description`, `timezone`, `dateFormat`. `title`/`tagline`/`description` are **consumed by the site now**; `timezone`/`dateFormat` are stored now, consumed later.
- Admin commit author: `OWNER_AUTHOR = { name: 'Local', email: 'local@setu.dev' }` (from `apps/admin/src/data/store.tsx`).
- The `/settings` screen is a **grouped shell**: General active; the existing captcha **Forms** status card preserved under a Forms section; other groups shown as **disabled "coming soon"** items.
- Reading malformed/missing settings → defaults (never throw). Saving **preserves unknown future top-level groups** (don't clobber a newer file).
- TDD; conventional commits ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: `@setu/core` — `SiteSettings` schema, defaults, parse + merge

**Files:**
- Create: `packages/core/src/settings/types.ts`
- Create: `packages/core/src/settings/defaults.ts`
- Create: `packages/core/src/settings/schema.ts`
- Create: `packages/core/test/settings/parse.test.ts`
- Modify: `packages/core/src/index.ts` (exports)

**Interfaces:**
- Produces: `GeneralSettings`, `SiteSettings`, `DEFAULT_SETTINGS`, `parseSettings(raw: unknown): SiteSettings`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/settings/parse.test.ts
import { describe, it, expect } from 'vitest'
import { parseSettings } from '../../src/settings/schema'
import { DEFAULT_SETTINGS } from '../../src/settings/defaults'

describe('parseSettings', () => {
  it('returns defaults for undefined / malformed input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS)
  })

  it('fills missing general keys from defaults', () => {
    const out = parseSettings({ general: { title: 'My Blog' } })
    expect(out.general.title).toBe('My Blog')
    expect(out.general.tagline).toBe(DEFAULT_SETTINGS.general.tagline)
    expect(out.general.timezone).toBe(DEFAULT_SETTINGS.general.timezone)
  })

  it('takes provided general values over defaults', () => {
    const out = parseSettings({
      general: { title: 'T', tagline: 'G', description: 'D', timezone: 'America/New_York', dateFormat: 'YYYY-MM-DD' },
    })
    expect(out.general).toEqual({
      title: 'T',
      tagline: 'G',
      description: 'D',
      timezone: 'America/New_York',
      dateFormat: 'YYYY-MM-DD',
    })
  })

  it('preserves unknown future top-level groups (forward-compat)', () => {
    const out = parseSettings({ general: { title: 'X' }, media: { widths: [400, 800] } }) as Record<string, unknown>
    expect(out.media).toEqual({ widths: [400, 800] })
    expect((out.general as { title: string }).title).toBe('X')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- settings/parse`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```typescript
// packages/core/src/settings/types.ts
/** The General settings group. title/tagline/description are consumed by the
 *  site; timezone/dateFormat are stored now and consumed when date display lands. */
export interface GeneralSettings {
  title: string
  tagline: string
  description: string
  timezone: string
  dateFormat: string
}

/** Site settings, grouped so future sections (identity/content/media/forms) add
 *  cleanly. Persisted as a Git-backed settings.json. Never holds secrets. */
export interface SiteSettings {
  general: GeneralSettings
}
```

```typescript
// packages/core/src/settings/defaults.ts
import type { SiteSettings } from './types'

export const DEFAULT_SETTINGS: SiteSettings = {
  general: {
    title: 'Setu',
    tagline: '',
    description: '',
    timezone: 'UTC',
    dateFormat: 'MMM D, YYYY',
  },
}
```

```typescript
// packages/core/src/settings/schema.ts
import { z } from 'zod'
import { DEFAULT_SETTINGS } from './defaults'
import type { SiteSettings } from './types'

const generalSchema = z
  .object({
    title: z.string(),
    tagline: z.string(),
    description: z.string(),
    timezone: z.string(),
    dateFormat: z.string(),
  })
  .partial()

// passthrough keeps unknown future top-level groups (forward-compat on read/save).
const settingsSchema = z.object({ general: generalSchema.optional() }).passthrough()

/** Parse a raw settings value and deep-merge over DEFAULT_SETTINGS. Malformed or
 *  missing input → defaults (never throws). Unknown future top-level groups are
 *  preserved on the returned object so an older admin won't clobber a newer file. */
export function parseSettings(raw: unknown): SiteSettings {
  const parsed = settingsSchema.safeParse(raw)
  const data: Record<string, unknown> = parsed.success ? parsed.data : {}
  const general = (data.general ?? {}) as Partial<SiteSettings['general']>
  return {
    ...data,
    general: { ...DEFAULT_SETTINGS.general, ...general },
  } as SiteSettings
}
```

- [ ] **Step 4: Add barrel exports**

In `packages/core/src/index.ts`, add (near the other config exports):

```typescript
export type { SiteSettings, GeneralSettings } from './settings/types'
export { DEFAULT_SETTINGS } from './settings/defaults'
export { parseSettings } from './settings/schema'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- settings/parse`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/settings packages/core/test/settings packages/core/src/index.ts
git commit -m "feat(core): SiteSettings schema, defaults, parseSettings"
```

---

## Task 2: Site consumes settings (load + theme Layout)

**Files:**
- Create: `apps/site/src/lib/site-settings.ts`
- Create: `apps/site/test/site-settings.test.ts`
- Modify: `packages/theme-default/Layout.astro`
- Modify: `packages/theme-default/PageLayout.astro`, `packages/theme-default/PostLayout.astro`
- Modify: `apps/site/src/pages/[...path].astro`, `apps/site/src/pages/index.astro`

**Interfaces:**
- Consumes: `parseSettings`, `SiteSettings` (Task 1).
- Produces: `loadSiteSettings(): SiteSettings`; theme layouts accept `siteSettings?: SiteSettings`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/site/test/site-settings.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSiteSettings } from '../src/lib/site-settings'

const dirs: string[] = []
afterEach(() => {
  delete process.env.SETU_CONTENT_DIR
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// loadSiteSettings reads <SETU_CONTENT_DIR>/../settings.json. Lay out root/content + root/settings.json.
function fixture(settings: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'setu-settings-'))
  dirs.push(root)
  if (settings !== undefined) writeFileSync(join(root, 'settings.json'), JSON.stringify(settings))
  process.env.SETU_CONTENT_DIR = join(root, 'content')
  return root
}

describe('loadSiteSettings', () => {
  it('reads settings.json and merges over defaults', () => {
    fixture({ general: { title: 'My Site' } })
    const s = loadSiteSettings()
    expect(s.general.title).toBe('My Site')
    expect(s.general.timezone).toBe('UTC') // default filled
  })
  it('returns defaults when the file is absent', () => {
    fixture(undefined)
    expect(loadSiteSettings().general.title).toBe('Setu')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/site test -- site-settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `loadSiteSettings`**

```typescript
// apps/site/src/lib/site-settings.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSettings, type SiteSettings } from '@setu/core'

/** settings.json lives at the content-repo root (sibling of `content/`): in dev that's
 *  `<SETU_CONTENT_DIR>/../`; otherwise this repo's root. Mirrors loadThemeOptions. */
function settingsFilePath(): string {
  const contentDir = process.env.SETU_CONTENT_DIR
  if (contentDir) return join(contentDir, '..', 'settings.json')
  return fileURLToPath(new URL('../../../../settings.json', import.meta.url))
}

/** Site settings for the build. Read FRESH per call (so `astro dev` reflects a freshly
 *  published file). Missing/malformed → defaults (never throws). */
export function loadSiteSettings(): SiteSettings {
  try {
    return parseSettings(JSON.parse(readFileSync(settingsFilePath(), 'utf8')) as unknown)
  } catch {
    return parseSettings(undefined)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/site test -- site-settings`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the theme `Layout.astro`**

Replace the frontmatter `Props`/destructure and the hardcoded brand + `<title>` + add a meta description. New `Layout.astro` frontmatter + head + header:

```astro
---
import './theme.css'
import './site.css'

import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/lora'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'

import { optionsToCss } from './options'
import type { SiteSettings } from '@setu/core'

interface Props {
  title: string
  lang?: string
  themeOptions?: Record<string, string>
  siteSettings?: SiteSettings
}
const { title, lang = 'en', themeOptions = {}, siteSettings } = Astro.props
const overrideCss = optionsToCss(themeOptions)
const siteTitle = siteSettings?.general.title ?? 'Setu'
const tagline = siteSettings?.general.tagline ?? ''
const description = siteSettings?.general.description ?? ''
const docTitle = title ? `${title} · ${siteTitle}` : siteTitle
---

<html lang={lang}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{docTitle}</title>
    {description && <meta name="description" content={description} />}
    <style is:inline set:html={overrideCss}></style>
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/">{siteTitle}</a>
      {tagline && <span class="site-tagline">{tagline}</span>}
      <nav>
        <a href="/">Home</a>
        <a href="/page/about">About</a>
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <footer class="site-footer">Built with Setu</footer>
  </body>
</html>
```

(The footer "Built with Setu" is attribution — keep it.)

- [ ] **Step 6: Thread `siteSettings` through `PageLayout.astro` + `PostLayout.astro`**

For BOTH files, add `siteSettings` to `Props` + destructure + pass to `Layout`. `PageLayout.astro`:

```astro
---
import Layout from './Layout.astro'
import type { SiteSettings } from '@setu/core'
interface Props { title: string; lang?: string; themeOptions?: Record<string, string>; siteSettings?: SiteSettings }
const { title, lang = 'en', themeOptions = {}, siteSettings } = Astro.props
---
<Layout title={title} lang={lang} themeOptions={themeOptions} siteSettings={siteSettings}>
  <article class="prose measure-page"><slot /></article>
</Layout>
```

`PostLayout.astro` is identical except `measure-post`:

```astro
---
import Layout from './Layout.astro'
import type { SiteSettings } from '@setu/core'
interface Props { title: string; lang?: string; themeOptions?: Record<string, string>; siteSettings?: SiteSettings }
const { title, lang = 'en', themeOptions = {}, siteSettings } = Astro.props
---
<Layout title={title} lang={lang} themeOptions={themeOptions} siteSettings={siteSettings}>
  <article class="prose measure-post"><slot /></article>
</Layout>
```

- [ ] **Step 7: Load + pass `siteSettings` in the page routes**

In `apps/site/src/pages/index.astro`, add the import + load + prop:

```astro
import { loadSiteSettings } from '../lib/site-settings'
// ...after themeOptions:
const siteSettings = loadSiteSettings()
```
and pass `siteSettings={siteSettings}` on the `<PageLayout ... />`.

In `apps/site/src/pages/[...path].astro`, add the same import, `const siteSettings = loadSiteSettings()` after `themeOptions`, and `siteSettings={siteSettings}` on the `<TemplateLayout ... />`.

- [ ] **Step 8: Verify the site builds + commit**

Run: `pnpm --filter @setu/site exec astro sync` (generates `astro:content` types in a fresh worktree), then `pnpm --filter @setu/site build`
Expected: build succeeds (the layout + loader compile).

```bash
git add apps/site/src/lib/site-settings.ts apps/site/test/site-settings.test.ts apps/site/src/pages/index.astro apps/site/src/pages/[...path].astro packages/theme-default/Layout.astro packages/theme-default/PageLayout.astro packages/theme-default/PostLayout.astro
git commit -m "feat(site): consume Git-backed site settings (title/tagline/description)"
```

---

## Task 3: Admin General settings form (read + commit `settings.json`)

**Files:**
- Create: `apps/admin/src/screens/settings/GeneralSettings.tsx`
- Create: `apps/admin/test/general-settings.test.tsx`

**Interfaces:**
- Consumes: `useServices().git` (`GitPort`), `OWNER_AUTHOR`, `parseSettings`/`DEFAULT_SETTINGS` (Task 1), `useNotify`.
- Produces: `GeneralSettings` React component that reads `settings.json`, edits the General group, and commits it back.

> Mirrors `apps/admin/src/screens/Appearance.tsx`: `const { git } = useServices()` → `git.readFile('settings.json')` baseline → edit → `git.commitFile({ path, content, message, author })` → `useNotify` success. Commit author is `OWNER_AUTHOR` (exported from `apps/admin/src/data/store.tsx` — import it; if it is not exported, export it there).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/general-settings.test.tsx
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { GeneralSettings } from '../src/screens/settings/GeneralSettings'

afterEach(() => localStorage.clear())

function renderGeneral() {
  const git = createMemoryGitPort([])
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <ActorProvider>
      <ServicesProvider services={services}>{children}</ServicesProvider>
    </ActorProvider>
  )
  render(wrapper(<GeneralSettings />))
  return { git }
}

describe('GeneralSettings', () => {
  it('edits the title and commits settings.json with the merged general group', async () => {
    const { git } = renderGeneral()
    const title = await screen.findByLabelText(/site title/i)
    fireEvent.change(title, { target: { value: 'My Blog' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).general.title).toBe('My Blog')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- general-settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Ensure `OWNER_AUTHOR` is exported**

In `apps/admin/src/data/store.tsx`, confirm `OWNER_AUTHOR` is exported (`export const OWNER_AUTHOR = ...`). If it is currently a non-exported `const`, add `export`.

- [ ] **Step 4: Implement `GeneralSettings.tsx`**

```tsx
// apps/admin/src/screens/settings/GeneralSettings.tsx
import { useEffect, useState } from 'react'
import { parseSettings, DEFAULT_SETTINGS, type GeneralSettings as GeneralValues } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../../data/store'
import { useNotify } from '../../ui/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const SETTINGS_PATH = 'settings.json'
const TIMEZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney']
const DATE_FORMATS = ['MMM D, YYYY', 'D MMM YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY']

const sameGeneral = (a: GeneralValues, b: GeneralValues) =>
  a.title === b.title && a.tagline === b.tagline && a.description === b.description && a.timezone === b.timezone && a.dateFormat === b.dateFormat

export function GeneralSettings() {
  const { git } = useServices()
  const notify = useNotify()
  // The full raw settings object (preserve unknown future groups on save).
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null)
  const [values, setValues] = useState<GeneralValues>(DEFAULT_SETTINGS.general)
  const [published, setPublished] = useState<GeneralValues | null>(null)
  const [saving, setSaving] = useState(false)

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
      const general = parseSettings(parsedRaw).general
      if (live) {
        setRaw(parsedRaw)
        setValues(general)
        setPublished(general)
      }
    })()
    return () => {
      live = false
    }
  }, [git])

  const dirty = published !== null && !sameGeneral(values, published)

  const set = (patch: Partial<GeneralValues>) => setValues((v) => ({ ...v, ...patch }))

  const save = async () => {
    if (saving || !dirty || raw === null) return
    setSaving(true)
    try {
      const next = { ...raw, general: values } // preserve unknown groups
      await git.commitFile({
        path: SETTINGS_PATH,
        content: JSON.stringify(next, null, 2) + '\n',
        message: 'chore(settings): update general settings',
        author: OWNER_AUTHOR,
      })
      setRaw(next)
      setPublished(values)
      notify.success('Settings saved')
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="set-title">Site title</Label>
        <Input id="set-title" value={values.title} onChange={(e) => set({ title: e.target.value })} placeholder="Setu" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="set-tagline">Tagline</Label>
        <Input id="set-tagline" value={values.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="A short tagline" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="set-desc">Description</Label>
        <Textarea id="set-desc" rows={3} value={values.description} onChange={(e) => set({ description: e.target.value })} placeholder="Used for the site meta description" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="set-tz">Timezone</Label>
          <select id="set-tz" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={values.timezone} onChange={(e) => set({ timezone: e.target.value })}>
            {[values.timezone, ...TIMEZONES.filter((t) => t !== values.timezone)].map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="set-df">Date format</Label>
          <select id="set-df" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={values.dateFormat} onChange={(e) => set({ dateFormat: e.target.value })}>
            {[values.dateFormat, ...DATE_FORMATS.filter((d) => d !== values.dateFormat)].map((df) => (
              <option key={df} value={df}>{df}</option>
            ))}
          </select>
        </div>
      </div>
      <Button onClick={() => void save()} disabled={published === null || !dirty || saving}>
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </Button>
    </div>
  )
}
```

> If `@/components/ui/textarea` does not exist, use the existing primitive the editor/forms use (grep `components/ui` — `textarea.tsx` exists in the admin per the Forms work). Match the real path.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/admin test -- general-settings`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @setu/admin typecheck`

```bash
git add apps/admin/src/screens/settings/GeneralSettings.tsx apps/admin/test/general-settings.test.tsx apps/admin/src/data/store.tsx
git commit -m "feat(admin): General settings form (read + commit settings.json)"
```

---

## Task 4: Grouped Settings shell (General + Forms card + "coming soon")

**Files:**
- Create: `apps/admin/src/screens/settings/Settings.tsx` (the grouped shell)
- Delete: `apps/admin/src/screens/Settings.tsx` (the flat captcha-only screen — its card moves into the shell)
- Modify: `apps/admin/src/app.tsx` (import path for `Settings`)

**Interfaces:**
- Consumes: `GeneralSettings` (Task 3); the existing `SpamProtectionStatus` (moved from the old `Settings.tsx`).

- [ ] **Step 1: Build the grouped shell**

Create `apps/admin/src/screens/settings/Settings.tsx`. It keeps a local active-group state, renders a left sub-nav (General active; Forms shows the preserved captcha status card; the rest disabled "coming soon"), and the active group's content on the right. Move the `SpamProtectionStatus` sub-component verbatim from the old `apps/admin/src/screens/Settings.tsx` into this file.

```tsx
// apps/admin/src/screens/settings/Settings.tsx
import { useEffect, useState } from 'react'
import { PageHeader } from '../../shell/PageHeader'
import { PageBody } from '../../shell/PageBody'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GeneralSettings } from './GeneralSettings'

const apiBase = import.meta.env.VITE_SETU_API as string | undefined

// Moved verbatim from the previous flat Settings.tsx (captcha PR).
function SpamProtectionStatus({ apiBase }: { apiBase: string }) {
  const [status, setStatus] = useState<{ provider: string; secretConfigured: boolean } | null>(null)
  useEffect(() => {
    void fetch(`${apiBase}/forms/captcha-status`)
      .then((r) => r.json() as Promise<{ provider: string; secretConfigured: boolean }>)
      .then(setStatus)
      .catch(() => setStatus({ provider: '', secretConfigured: false }))
  }, [apiBase])
  if (!status) return null
  const label = !status.provider
    ? 'Spam protection: not configured'
    : status.secretConfigured
      ? `Spam protection: ${status.provider} — secret detected ✓`
      : `Spam protection: ${status.provider} — secret missing ⚠ (set SETU_${status.provider.toUpperCase()}_SECRET)`
  return <p className="text-sm text-muted-foreground">{label}</p>
}

function FormsGroup() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Spam protection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {apiBase ? <SpamProtectionStatus apiBase={apiBase} /> : <p className="text-sm text-muted-foreground">Spam protection: not configured</p>}
        <p className="text-xs text-muted-foreground">More form settings coming soon.</p>
      </CardContent>
    </Card>
  )
}

type GroupId = 'general' | 'forms'
const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'forms', label: 'Forms' },
]
const COMING_SOON = ['Identity', 'Content & Reading', 'Media', 'Users & Roles', 'SEO & Privacy', 'Deploy']

export function Settings() {
  const [active, setActive] = useState<GroupId>('general')
  return (
    <>
      <PageHeader title="Settings" />
      <PageBody>
        <div className="flex gap-6">
          <nav className="w-48 shrink-0 space-y-1" aria-label="Settings sections">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setActive(g.id)}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-sm ${active === g.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {g.label}
              </button>
            ))}
            {COMING_SOON.map((label) => (
              <span key={label} className="block cursor-not-allowed rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground/50" title="Coming soon">
                {label}
              </span>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            {active === 'general' ? <GeneralSettings /> : <FormsGroup />}
          </div>
        </div>
      </PageBody>
    </>
  )
}
```

> Match the `bg-accent`/`text-accent-foreground` etc. token names to whatever the admin's active-nav styling uses elsewhere (grep an existing active nav item, e.g. `AppSidebar`); the structure is what matters.

- [ ] **Step 2: Remove the old flat screen + fix the import**

```bash
git rm apps/admin/src/screens/Settings.tsx
```

In `apps/admin/src/app.tsx`, update the `Settings` import to the new path:

```typescript
import { Settings } from './screens/settings/Settings'
```

(The `<Route path="/settings" element={<Settings />} />` line stays.)

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @setu/admin typecheck`
Run: `pnpm --filter @setu/admin build`
Expected: PASS.

- [ ] **Step 4: UAT**

With the dev stack running, open the admin `/settings`:
1. **General** is selected; edit **Site title** + tagline + description, pick a timezone/date format → **Save changes** → success cue; the button settles to "Saved". Reload the screen → values persist (committed to `settings.json`).
2. **Forms** section shows the spam-protection status card (provider + secret detected/missing).
3. The other sections (Identity, Content & Reading, Media, Users & Roles, SEO & Privacy, Deploy) appear **disabled / "coming soon"**.
4. On the **site**, after saving a title, the header brand + browser tab title reflect it (rebuild/refresh).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/screens/settings/Settings.tsx apps/admin/src/app.tsx
git commit -m "feat(admin): grouped Settings shell (General + Forms status + coming-soon)"
```

**Final:** request a whole-branch review (`superpowers:requesting-code-review`), then `superpowers:finishing-a-development-branch`.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**
- Git-backed `settings.json` via the Appearance commit path → Task 3. ✅
- `SiteSettings` schema (grouped) + defaults + merge, secrets-free → Task 1. ✅
- Site consumes title/tagline/description (replace hardcoded "Setu") → Task 2. ✅
- `/settings` grouped shell; General active; future groups "coming soon"; captcha Forms card preserved → Task 4. ✅
- Malformed/missing → defaults; save preserves unknown future groups → Task 1 (`parseSettings` passthrough) + Task 3 (`{ ...raw, general }`). ✅
- timezone/dateFormat stored now, consumed later → Tasks 1/3 (stored), not wired to site (deferred). ✅

**2. Placeholder scan:** No TBD/TODO; code steps carry complete code. Two touch-points name a grep target for an exact token/path (the `textarea` primitive path, the active-nav token names) rather than guessing — both with a concrete fallback.

**3. Type consistency:** `SiteSettings`/`GeneralSettings`/`DEFAULT_SETTINGS`/`parseSettings`, `settings.json` path, `OWNER_AUTHOR`, and `git.commitFile({ path, content, message, author })` are consistent across Tasks 1–4. The grouped shape `{ general: {...} }` is used identically in core, site, and admin.

**Open questions resolved:** O1 → `settings.json` + grouped object. O2 → future groups shown as disabled "coming soon". O3 → preserve unknown groups on save (`{ ...raw, general }` + Zod `.passthrough()`). O4 → curated `<select>`s for timezone + date format, current value always shown.
