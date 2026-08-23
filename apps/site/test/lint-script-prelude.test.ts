import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** #1016. This package's `lint` script is NOT a bare `eslint .` — it regenerates the block and
 *  relation caches and runs `astro sync` first, because the type-aware rules need the generated
 *  `astro:content` types. Without them `getCollection()` degrades to `any` and eslint reports ~62
 *  `@typescript-eslint/no-unsafe-*` errors in four files (src/lib/permalinks.ts,
 *  src/lib/sitemap-entries.ts and the two rss.xml.ts routes).
 *
 *  That dependency used to be implicit and satisfied only by luck of ordering: CI runs
 *  `turbo run typecheck test lint`, and `typecheck` performs the same sync as a side effect, so
 *  lint was clean in CI while `pnpm --filter @setu/site lint` on a fresh checkout failed. The
 *  failure mode is therefore SILENCE — it looks like a broken working copy, not a missing task
 *  dependency, and it cost a session's worth of chasing before it was diagnosed.
 *
 *  So this asserts the prelude is still wired. It is a shape check on the script rather than a
 *  behavioural one on purpose: reproducing the real failure means deleting `.astro` and running
 *  eslint over the whole app, which is far too slow for a unit suite — and a shape check still
 *  fails loudly the moment someone "simplifies" the script back to `eslint .`. */
const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)),
    'utf8'
  )
) as { scripts: Record<string, string> }

describe('apps/site lint script prelude (#1016)', () => {
  it('runs astro sync before eslint, so the content types exist', () => {
    const lint = pkg.scripts.lint
    expect(lint, 'no lint script at all').toBeTypeOf('string')
    expect(
      lint,
      'apps/site lint must run `astro sync` first — without the generated astro:content types the type-aware rules report ~62 phantom no-unsafe-* errors (#1016)'
    ).toContain('astro sync')
    expect(lint.indexOf('astro sync')).toBeLessThan(lint.indexOf('eslint'))
  })

  it('regenerates the block and relation caches the sync depends on', () => {
    const lint = pkg.scripts.lint
    expect(lint).toContain('gen-blocks.mjs')
    expect(lint).toContain('gen-relations.mjs')
  })

  it('keeps the same prelude as typecheck, so the two cannot drift apart', () => {
    const prelude = (s: string) => s.slice(0, s.lastIndexOf('&&'))
    expect(prelude(pkg.scripts.lint)).toBe(prelude(pkg.scripts.typecheck))
  })
})
