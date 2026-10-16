// Guard for #1295: no code outside the theme that owns the name may assume the typeface option is
// keyed `font`. The site build finds it by `role: 'typeface'` (packages/core/src/theme/options.ts);
// a stray `?.font` / `['font']` / `key === 'font'` elsewhere reintroduces the bug where a theme
// naming the option `typeface` gets its DEFAULT family bundled while the CSS names the chosen one.
//
// Rides the `pnpm test:scripts` lane because it reads the whole repo, which no single workspace
// package's turbo inputs could honestly cover.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCAN = ['apps', 'packages', 'blocks', 'scripts']
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.astro',
  '.turbo',
  'coverage'
])
/** The one theme allowed to know its own key. */
const OWNER = `packages${sep}theme-default${sep}`
const SELF = relative(ROOT, fileURLToPath(import.meta.url))
const EXT = /\.(?:[cm]?[jt]sx?|astro)$/

/** Property access `.font` / `?.font`, bracket access `['font']`, or a `key === 'font'` lookup.
 *  `(?![\w-])` keeps `.fontSize`, `.font-body` and `font-loading` out. */
export const ASSUMES_FONT_KEY =
  /(?:\?\.|\.)font(?![\w-])|\[\s*['"`]font['"`]\s*\]|key\s*===?\s*['"`]font['"`]/

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(join(dir, entry.name))
    } else if (EXT.test(entry.name)) yield join(dir, entry.name)
  }
}

test('the pattern catches each way the key used to be assumed (kill-shot for the scan)', () => {
  for (const hit of [
    'JSON.parse(raw)?.font',
    'config.themeOptions.font',
    "values['font']",
    "themeOptions.find((o) => o.key === 'font')"
  ])
    assert.match(hit, ASSUMES_FONT_KEY, hit)
  for (const miss of [
    'style.fontSize',
    "'--font-body'",
    'performance.font-loading',
    "{ font: 'inter' }"
  ])
    assert.doesNotMatch(miss, ASSUMES_FONT_KEY, miss)
})

test('no code outside packages/theme-default assumes the typeface option is keyed `font`', () => {
  const offenders = []
  for (const top of SCAN)
    for (const file of sourceFiles(join(ROOT, top))) {
      const rel = relative(ROOT, file)
      if (rel.startsWith(OWNER) || rel === SELF) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (ASSUMES_FONT_KEY.test(line))
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        })
    }
  assert.deepEqual(
    offenders,
    [],
    `find the typeface option by role (typefaceOption / selectedTypeface in @setu/core), not by key:\n${offenders.join('\n')}`
  )
})
