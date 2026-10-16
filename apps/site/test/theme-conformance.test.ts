import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '@setu/core'
import {
  checkThemeStatic,
  definesToken,
  discoverWorkspaceThemes,
  isThemePackageName,
  workspaceGlobs
} from './lib/theme-conformance'

// Theme conformance, static half (#1297, epic #342): every theme package in the workspace ships
// what apps/site needs to render through it. Themes are DISCOVERED (./lib/theme-conformance.ts),
// so a new workspace theme is checked without being listed here. The render half is
// theme-conformance-render.test.ts.
//
// The "catches a broken theme" block is the standing kill-shot for each assertion: it runs the
// same check against copies of a minimal fixture theme (test/fixtures/themes/minimal), each with
// one obligation removed, and requires the specific author-facing message.

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const themes = discoverWorkspaceThemes(repoRoot)

describe('theme discovery', () => {
  it('finds the default theme, so the per-theme checks below are not vacuous', () => {
    expect(themes.map((t) => t.name)).toContain(DEFAULT_THEME)
  })

  it('every workspace theme lives at packages/theme-*, which turbo hashes for this suite', () => {
    // turbo.json's @setu/site#test inputs list `../../packages/theme-*/**`: a theme outside that
    // glob could change without re-running its own conformance check from cache.
    for (const t of themes) expect(t.dir).toMatch(/^packages\/theme-[^/]+$/)
  })

  it('recognises theme package names by their last segment', () => {
    expect(isThemePackageName('@setu/theme-default')).toBe(true)
    expect(isThemePackageName('@acme/theme-docs')).toBe(true)
    expect(isThemePackageName('theme-plain')).toBe(true)
    expect(isThemePackageName('@setu/core')).toBe(false)
    expect(isThemePackageName('@setu/themes')).toBe(false)
    expect(isThemePackageName('@theme-co/blocks')).toBe(false)
  })

  it('reads the workspace globs and refuses a shape it cannot expand', () => {
    expect(
      workspaceGlobs(
        "packages:\n  - 'packages/*'\n  - 'apps/*'\n\nauditConfig:\n  x: 1\n"
      )
    ).toEqual(['packages/*', 'apps/*'])
    expect(() => workspaceGlobs("packages:\n  - 'packages/**'\n")).toThrow(
      /not of the form/
    )
  })
})

describe.each(themes)('workspace theme $name', ({ dir }) => {
  it('meets the static theme contract', async () => {
    expect(await checkThemeStatic(join(repoRoot, dir))).toEqual([])
  })
})

describe('definesToken', () => {
  it('counts a declaration, not a read or a comment', () => {
    expect(
      definesToken(':root { --measure-post: 38rem; }', '--measure-post')
    ).toBe(true)
    expect(definesToken(':root{--measure-post:38rem}', '--measure-post')).toBe(
      true
    )
    expect(
      definesToken('.x { max-width: var(--measure-post); }', '--measure-post')
    ).toBe(false)
    expect(
      definesToken('/* --measure-post: 38rem; */ :root {}', '--measure-post')
    ).toBe(false)
    expect(definesToken(':root { --measure-post: ; }', '--measure-post')).toBe(
      false
    )
  })
})

describe('the check catches a broken theme', () => {
  const fixture = fileURLToPath(
    new URL('./fixtures/themes/minimal', import.meta.url)
  )
  const copies: string[] = []
  afterAll(() => {
    for (const c of copies) rmSync(c, { recursive: true, force: true })
  })

  /** A fresh copy of the minimal fixture theme, broken by `mutate`. */
  function brokenTheme(mutate: (dir: string) => void): string {
    const dir = mkdtempSync(join(tmpdir(), 'setu-theme-conformance-'))
    copies.push(dir)
    cpSync(fixture, dir, { recursive: true })
    mutate(dir)
    return dir
  }
  const editJson = (
    dir: string,
    edit: (pkg: { exports: Record<string, string> }) => void
  ) => {
    const file = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
      exports: Record<string, string>
    }
    edit(pkg)
    writeFileSync(file, JSON.stringify(pkg))
  }

  it('passes the unbroken fixture (so every failure below is the mutation)', async () => {
    expect(await checkThemeStatic(brokenTheme(() => {}))).toEqual([])
  })

  it('names a missing component export, why the site needs it, and the contract', async () => {
    const dir = brokenTheme((d) =>
      editJson(d, (pkg) => delete pkg.exports['./ArchiveList.astro'])
    )
    const findings = await checkThemeStatic(dir)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(
      /\[conformance-fixture-minimal\] does not export "\.\/ArchiveList\.astro"\. The site needs it because the posts archive and every category and tag archive/
    )
    expect(findings[0]).toContain('ArchiveListProps')
    expect(findings[0]).toContain('https://github.com/withsetu/setu/issues/342')
  })

  it('names an export whose file is missing', async () => {
    const dir = brokenTheme((d) => unlinkSync(join(d, 'TaxonomyChips.astro')))
    const findings = await checkThemeStatic(dir)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(
      /exports "\.\/TaxonomyChips\.astro", but the file it points to .* does not exist/
    )
  })

  it('names a missing theme.css', async () => {
    const dir = brokenTheme((d) =>
      editJson(d, (pkg) => delete pkg.exports['./theme.css'])
    )
    const findings = await checkThemeStatic(dir)
    expect(
      findings.some((f) => /does not export "\.\/theme\.css"/.test(f))
    ).toBe(true)
  })

  it('rejects an options declaration that does not parse, with the parser’s reason', async () => {
    const dir = brokenTheme((d) =>
      writeFileSync(
        join(d, 'options.ts'),
        "export const themeOptions = [{ key: 'font', label: 'Font', type: 'select', token: '--font-body', default: 'a' }]\n"
      )
    )
    const findings = await checkThemeStatic(dir)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(
      /has an options declaration \("\.\/options"\) the Customizer cannot use: invalid theme options declaration: option "font": a select needs choices/
    )
  })

  it('rejects an options module with no `themeOptions` export', async () => {
    const dir = brokenTheme((d) =>
      writeFileSync(join(d, 'options.ts'), 'export const options = []\n')
    )
    const findings = await checkThemeStatic(dir)
    expect(findings).toEqual([
      expect.stringMatching(/no `themeOptions` export/)
    ])
  })

  it('accepts a theme with no options export (nothing to customise is legitimate)', async () => {
    const dir = brokenTheme((d) =>
      editJson(d, (pkg) => delete pkg.exports['./options'])
    )
    expect(await checkThemeStatic(dir)).toEqual([])
  })

  it('names a font package the fonts entry declares but cannot resolve', async () => {
    const dir = brokenTheme((d) => {
      editJson(d, (pkg) => (pkg.exports['./fonts'] = './fonts.ts'))
      writeFileSync(
        join(d, 'fonts.ts'),
        "export const fontPackagesFor = (_choice: string | undefined): string[] => ['@setu-fixture/no-such-font']\n"
      )
    })
    const findings = await checkThemeStatic(dir)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(
      /its fonts entry names "@setu-fixture\/no-such-font", which does not resolve from the theme/
    )
  })

  it('names a fonts entry with no `fontPackagesFor`', async () => {
    const dir = brokenTheme((d) => {
      editJson(d, (pkg) => (pkg.exports['./fonts'] = './fonts.ts'))
      writeFileSync(join(d, 'fonts.ts'), 'export const FONTS = {}\n')
    })
    expect(await checkThemeStatic(dir)).toEqual([
      expect.stringMatching(/no `fontPackagesFor\(choice\)` function/)
    ])
  })

  it('names a missing measure token', async () => {
    const dir = brokenTheme((d) =>
      writeFileSync(
        join(d, 'theme.css'),
        ':root { --measure-post: 40rem; }\n.wide { max-width: var(--measure-page); }\n'
      )
    )
    const findings = await checkThemeStatic(dir)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(
      /does not define --measure-page in any stylesheet it exports/
    )
  })
})
