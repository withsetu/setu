// The static half of the theme conformance check (#1297): what a theme package must ship for
// apps/site to render through it. The render half — building the standard pages through each
// theme — is apps/site/test/theme-conformance-render.test.ts.
//
// Every message here is read by a theme AUTHOR, not by a Setu maintainer: it names the theme,
// the obligation it misses, why the site needs it, and where the contract is written down.
//
// The contract's reference is the #342 epic for now. It is intended to point at
// docs/theme-contract.md once #1299 writes that document; update CONTRACT_REF then.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseThemeOptions, type ThemeOption } from '@setu/core'

export const CONTRACT_REF =
  'Theme contract: https://github.com/withsetu/setu/issues/342'

/** A route component apps/site imports from the active theme as `@theme/<file>`. */
export interface RequiredExport {
  subpath: string
  why: string
}

/** The four components apps/site/src imports through the `@theme` alias, and the props type
 *  from @setu/core each one receives (packages/core/src/theme/layout-props.ts). */
export const REQUIRED_COMPONENTS: RequiredExport[] = [
  {
    subpath: './PageLayout.astro',
    why: 'pages, the homepage, every archive and the editor preview render inside it (props: PageLayoutProps from @setu/core)'
  },
  {
    subpath: './PostLayout.astro',
    why: 'every post renders inside it (props: PostLayoutProps from @setu/core)'
  },
  {
    subpath: './ArchiveList.astro',
    why: 'the posts archive and every category and tag archive list their posts through it (props: ArchiveListProps from @setu/core)'
  },
  {
    subpath: './TaxonomyChips.astro',
    why: "a post's category and tag links render through it (props: TaxonomyChipsProps from @setu/core)"
  }
]

/** apps/site/astro.config.mjs resolves `<theme>/theme.css` to find the theme's own directory,
 *  and resolves the theme's font packages from there. */
export const REQUIRED_STYLESHEETS: RequiredExport[] = [
  {
    subpath: './theme.css',
    why: "it carries the theme's design tokens, and the site build locates the theme's font packages from it"
  }
]

/** Layout measures the theme must set. Post content, image alignment (@setu/image-astro) and
 *  the wide/full block breakouts size against them. */
export const REQUIRED_TOKENS = ['--measure-post', '--measure-page'] as const

export interface WorkspaceTheme {
  name: string
  /** Repo-relative, e.g. `packages/theme-default`. */
  dir: string
}

/** A workspace package is a theme when its name's last segment starts with `theme-`
 *  (`@setu/theme-default`, `@acme/theme-docs`). Intended to match how themes are named in this
 *  repo; apps/site/test/theme-conformance.test.ts checks that discovery finds the default theme. */
export function isThemePackageName(name: string): boolean {
  return /(^|\/)theme-[a-z0-9][a-z0-9-]*$/.test(name)
}

/** The `dir/*` globs listed under `packages:` in pnpm-workspace.yaml. Any other glob shape
 *  throws, so a workspace layout change cannot silently shrink the set of themes checked. */
export function workspaceGlobs(yaml: string): string[] {
  const globs: string[] = []
  let inPackages = false
  for (const line of yaml.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    const item = /^\s+-\s+['"]?([^'"#\s]+)['"]?\s*$/.exec(line)
    if (item) {
      globs.push(item[1])
      continue
    }
    if (/^\S/.test(line)) break
  }
  for (const g of globs)
    if (!/^[\w.-]+\/\*$/.test(g))
      throw new Error(
        `pnpm-workspace.yaml glob "${g}" is not of the form "dir/*" — teach discoverWorkspaceThemes it`
      )
  if (globs.length === 0)
    throw new Error('pnpm-workspace.yaml lists no packages')
  return globs
}

/** Every theme package in the workspace, sorted by name. */
export function discoverWorkspaceThemes(repoRoot: string): WorkspaceTheme[] {
  const yaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
  const themes: WorkspaceTheme[] = []
  for (const glob of workspaceGlobs(yaml)) {
    const parent = glob.slice(0, -2)
    for (const entry of readdirSync(join(repoRoot, parent), {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) continue
      const pkgPath = join(repoRoot, parent, entry.name, 'package.json')
      if (!existsSync(pkgPath)) continue
      const { name } = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        name?: string
      }
      if (name && isThemePackageName(name))
        themes.push({ name, dir: `${parent}/${entry.name}` })
    }
  }
  return themes.sort((a, b) => a.name.localeCompare(b.name))
}

interface PackageJson {
  name?: string
  exports?: unknown
}

/** Node's subpath-export resolution, reduced to the shapes a theme uses: an exact key or a
 *  single-`*` pattern, mapping to a string or to an `import`/`default` condition. A package
 *  with no `exports` exposes every file. Returns the absolute target, or null when the subpath
 *  is not exported. */
export function resolveExport(
  dir: string,
  pkg: PackageJson,
  subpath: string
): string | null {
  if (pkg.exports === undefined) return join(dir, subpath)
  if (typeof pkg.exports !== 'object' || pkg.exports === null) return null
  const map = pkg.exports as Record<string, unknown>
  const pick = (target: unknown): string | null => {
    if (typeof target === 'string') return target
    if (target && typeof target === 'object') {
      const t = target as Record<string, unknown>
      return pick(t.import ?? t.default)
    }
    return null
  }
  if (subpath in map) {
    const t = pick(map[subpath])
    return t ? join(dir, t) : null
  }
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf('*')
    if (star === -1) continue
    const [pre, post] = [key.slice(0, star), key.slice(star + 1)]
    if (!subpath.startsWith(pre) || !subpath.endsWith(post)) continue
    const t = pick(value)
    if (!t) continue
    return join(
      dir,
      t.replace('*', subpath.slice(pre.length, subpath.length - post.length))
    )
  }
  return null
}

/** Every stylesheet the theme exports (explicit `*.css` subpaths), plus the required ones. */
function exportedStylesheets(dir: string, pkg: PackageJson): string[] {
  const subpaths = new Set(REQUIRED_STYLESHEETS.map((s) => s.subpath))
  if (pkg.exports && typeof pkg.exports === 'object')
    for (const key of Object.keys(pkg.exports))
      if (key.endsWith('.css') && !key.includes('*')) subpaths.add(key)
  return [...subpaths]
    .map((s) => resolveExport(dir, pkg, s))
    .filter((f): f is string => f !== null && existsSync(f))
}

/** True when `css` DEFINES `token` with a non-empty value (a `var(--x)` read does not count). */
export function definesToken(css: string, token: string): boolean {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const escaped = token.replace(/[-]/g, '\\-')
  return new RegExp(`(^|[\\s;{])${escaped}\\s*:\\s*[^;}\\s]`).test(code)
}

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * Check one theme package against the static half of the contract. Returns one author-facing
 * message per broken obligation; an empty array means the theme conforms.
 *
 * `dir` is the theme package's absolute directory.
 */
export async function checkThemeStatic(dir: string): Promise<string[]> {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath))
    return [`${dir} has no package.json. ${CONTRACT_REF}`]
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson
  const theme = pkg.name ?? dir
  const findings: string[] = []
  const say = (msg: string) =>
    findings.push(`[${theme}] ${msg} ${CONTRACT_REF}`)

  // 1. Required component exports and stylesheets.
  for (const req of [...REQUIRED_COMPONENTS, ...REQUIRED_STYLESHEETS]) {
    const target = resolveExport(dir, pkg, req.subpath)
    if (target === null)
      say(
        `does not export "${req.subpath}". The site needs it because ${req.why}. Add it to "exports" in package.json.`
      )
    else if (!existsSync(target))
      say(
        `exports "${req.subpath}", but the file it points to (${target}) does not exist. The site needs it because ${req.why}.`
      )
  }

  // 2. The options declaration. Optional: a theme with nothing to customise exports no
  //    `./options` (the Customizer then shows none). When present it must parse.
  let options: ThemeOption[] = []
  const optionsFile = resolveExport(dir, pkg, './options')
  if (optionsFile !== null) {
    try {
      const mod = (await import(pathToFileURL(optionsFile).href)) as {
        themeOptions?: unknown
      }
      if (mod.themeOptions === undefined)
        say(
          'exports "./options" but that module has no `themeOptions` export. The Customizer reads its declaration from `themeOptions`.'
        )
      else options = parseThemeOptions(mod.themeOptions)
    } catch (err) {
      say(
        `has an options declaration ("./options") the Customizer cannot use: ${errorText(err)}. Every option needs a key, a label, a type of "color" or "select", the CSS custom property it drives, and a valid default.`
      )
    }
  }

  // 3. The fonts entry, when the theme ships one: every package it names for any select
  //    choice (and for no choice) must resolve from the theme, as apps/site/astro.config.mjs
  //    resolves them. A theme with no `./fonts` export ships its fonts itself.
  const fontsFile = resolveExport(dir, pkg, './fonts')
  if (fontsFile !== null) {
    try {
      const mod = (await import(pathToFileURL(fontsFile).href)) as {
        fontPackagesFor?: unknown
      }
      if (typeof mod.fontPackagesFor !== 'function')
        say(
          'exports "./fonts" but that module has no `fontPackagesFor(choice)` function. The site build calls it to bundle the selected font family.'
        )
      else {
        const fontPackagesFor = mod.fontPackagesFor as (
          choice: string | undefined
        ) => unknown
        const choices = [
          undefined,
          ...options.flatMap((o) => (o.choices ?? []).map((c) => c.value))
        ]
        const req = createRequire(pkgPath)
        const unresolved = new Set<string>()
        for (const choice of choices) {
          const pkgs = fontPackagesFor(choice)
          if (!Array.isArray(pkgs) || pkgs.some((p) => typeof p !== 'string')) {
            say(
              `fontPackagesFor(${JSON.stringify(choice)}) must return an array of package names; it returned ${JSON.stringify(pkgs)}.`
            )
            continue
          }
          for (const p of pkgs as string[]) {
            try {
              req.resolve(p)
            } catch {
              unresolved.add(p)
            }
          }
        }
        for (const p of unresolved)
          say(
            `its fonts entry names "${p}", which does not resolve from the theme. Add it to the theme's dependencies, or the site build fails when that font is selected.`
          )
      }
    } catch (err) {
      say(`exports "./fonts" but that module fails to load: ${errorText(err)}.`)
    }
  }

  // 4. Measure tokens, defined in any stylesheet the theme exports.
  const sheets = exportedStylesheets(dir, pkg)
  const css = sheets.map((f) => readFileSync(f, 'utf8')).join('\n')
  for (const token of REQUIRED_TOKENS)
    if (!definesToken(css, token))
      say(
        `does not define ${token} in any stylesheet it exports. Post content, image alignment and wide/full blocks size against it. Set it on :root in theme.css (the default theme sets --measure-post: 38rem and --measure-page: 64rem).`
      )

  return findings
}
