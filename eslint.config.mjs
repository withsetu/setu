// Setu root ESLint flat config (#267 T1).
//
// Scope decisions (see issue #267 for the full plan):
//  - Type-aware typescript-eslint via `projectService` — auto-discovers the nearest
//    tsconfig.json per file instead of us hand-listing all 26 package tsconfigs.
//  - react-hooks stays scoped to `apps/admin/**` ONLY. Themes/site and shared block
//    components render on the front end and are deliberately NOT bound to admin
//    conventions (see CLAUDE.md "Admin vs. front-end themes") — they get base TS rules
//    only, even where they happen to use JSX.
//  - jsx-a11y was admin-only in T1 and is NOT any more (#819): it now also covers
//    packages/theme-default and packages/blocks, plus every `.astro` file. That is the
//    opposite of the shadcn-conventions argument above — accessibility is a property of
//    the rendered page, and the public rendering path is where it matters MOST. The
//    admin-only scope meant a11y rules ran on the internal tool and not on what visitors
//    read, while apps/site/test/a11y.test.ts already runs axe over those same pages.
//  - `.astro` files ARE linted (#819, was deferred in T1): eslint-plugin-astro's flat
//    config + astro-eslint-parser, syntactic and a11y rules only — see the astro block.
//  - `prototype/` is excluded: three frozen, pre-rebrand (2026-06-18) spike directories,
//    each with its own package.json + lockfile outside the pnpm workspace. Not part of
//    the product's TS project graph and not actively maintained.
//  - Root-level loose scripts (`scripts/*.mjs`, `apps/site/*.config.mjs`, etc.) aren't
//    covered by any tsconfig's `include`, so they get base (non-type-aware) rules only
//    rather than fighting `projectService`'s `allowDefaultProject` for a handful of files.
//  - `blocks/<tag>/block.ts` (root-level, auto-discovered content blocks — see
//    packages/core/src/blocks/registry.ts + scripts/gen-blocks.mjs) DOES need type-aware
//    linting — it's live product code — so it's opted into `projectService` via
//    `allowDefaultProject`, which project-service supports for a small, explicit glob.
// This config file itself runs under Node (only the LINTED edge dirs must stay
// Node-free), so importing node builtins HERE is fine — see the edge-guard block below.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { builtinModules } from 'node:module'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import astro from 'eslint-plugin-astro'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'

const IGNORES = [
  // Build outputs / dependency trees
  '**/dist/**',
  '**/node_modules/**',
  '**/.astro/**',
  '**/.setu/**',
  '**/.content-sandbox/**',
  '**/.turbo/**',
  // Generated at build time (scripts/gen-blocks.mjs) — not authored, regenerate on build
  'apps/site/markdoc.blocks.generated.mjs',
  // Playwright output + visual-baseline snapshots (binary/generated, not hand-authored)
  'e2e/test-results/**',
  'e2e/playwright-report/**',
  'e2e/**/*-snapshots/**',
  // Frozen pre-rebrand spikes with their own package.json/lockfile — see header comment
  'prototype/**',
  // Ambient type shims (not in any package's tsconfig program, so type-aware linting can't
  // parse them) — e.g. types/jsdom-shim.d.ts, which blocks the vitest→lib.dom leak (#405)
  'types/**'
  // `'**/*.astro'` used to sit here (#267 T1's documented deferral). Removed in #819 —
  // eslint-plugin-astro now lints them; see the astro block below.
]

// ---- Edge-guard rule inputs (#434) ----
// The edge-reachable dir list is owned by packages/core/tsconfig.edge.json (`include`);
// we READ it at config-load time so the two can never drift. The tsconfig-based edge
// guard proves the TYPE graph is Node-free but cannot fail on a `node:` MODULE import
// (with `types: []` the import just loses its types); this lint override is the guard
// that actually fails on Node module imports / globals in edge-reachable core code.
// NOTE: that tsconfig must stay comment-free strict JSON (repo convention — no repo
// tsconfig uses JSONC comments) or this JSON.parse fails loudly at lint startup.
const edgeTsconfig = JSON.parse(
  readFileSync(
    new URL('./packages/core/tsconfig.edge.json', import.meta.url),
    'utf8'
  )
)
// `include` entries are dirs like "src/blocks" → glob packages/core/src/blocks/**/*.ts
const edgeFiles = edgeTsconfig.include.map(
  (dir) => `packages/core/${dir}/**/*.{ts,tsx}`
)
// Every bare-resolvable Node builtin (fs, path, fs/promises, …) from the runtime itself.
// These go in no-restricted-imports `paths` (EXACT specifier match), NOT `patterns`:
// patterns are gitignore-style and a bare `url` pattern also matches relative imports
// into core's src/url/ directory ('../url/locale' — real false positive caught while
// building this, #434). Exact paths can't collide with relative specifiers; the
// node:-prefixed forms are caught by a `^node:` regex pattern in the rule below.
const NODE_BUILTIN_IMPORT_MESSAGE =
  'This module is edge-reachable (packages/core/tsconfig.edge.json) and must run on Cloudflare Workers — no Node builtins. Put Node-bound work behind a port/adapter instead (docs/architecture.md, "edge-safe core").'
const NODE_BUILTIN_PATHS = builtinModules.map((name) => ({
  name,
  message: NODE_BUILTIN_IMPORT_MESSAGE
}))

// ---- allowDefaultProject list for the per-package vitest configs (#818) ----
// Every packages/*/vitest.config.ts is a tool config that vitest's esbuild transform
// evaluates directly, so it is deliberately outside its package's tsconfig `include` and
// needs a projectService single-file program. WITH ONE EXCEPTION: theme-default's source is
// flat at the package root, so its tsconfig `include` is `["*.ts", "*.d.ts"]` and its
// vitest.config.ts is ALREADY in a real program — projectService hard-errors on a file that
// matches both ("was included by allowDefaultProject but also was found in the project
// service"). The exception is DERIVED, not hardcoded to a package name, by asking each
// tsconfig whether its `include` reaches the package root.
// Not expressed as a `!`-negated glob: allowDefaultProject entries go through minimatch
// individually, so a `!` entry inverts to "match everything else" and silently pulls the
// whole repo into the default project — measured, 1084 parse errors, not a theory.
// Same JSONC caveat as the edge tsconfig read above: these must stay comment-free JSON.
const packagesDir = new URL('./packages/', import.meta.url)
const PACKAGE_VITEST_CONFIGS = readdirSync(packagesDir)
  .filter((pkg) => existsSync(new URL(`${pkg}/vitest.config.ts`, packagesDir)))
  .filter((pkg) => {
    const tsconfig = JSON.parse(
      readFileSync(new URL(`${pkg}/tsconfig.json`, packagesDir), 'utf8')
    )
    const include = tsconfig.include ?? []
    // A root-relative glob like "*.ts" covers the package root; "src"/"test" do not.
    return !include.some((glob) => glob.startsWith('*'))
  })
  .map((pkg) => `packages/${pkg}/vitest.config.ts`)

export default tseslint.config(
  { ignores: IGNORES },

  // ---- Base JS recommended (applies to every JS/TS file we lint) ----
  js.configs.recommended,

  // ---- Type-aware TypeScript, scoped to real package/app source + e2e + root blocks/ ----
  {
    files: [
      // Whole package/app trees, not just src/test — theme-default keeps its .ts files
      // flat at the package root (no src/ dir) and db-sqlite has a root drizzle.config.ts,
      // so scoping to {src,test} would silently drop those onto the base (non-type-aware)
      // JS parser instead, producing bogus "Parsing error: Unexpected token" TS-syntax
      // errors (caught while dogfooding this config — see task report).
      'packages/*/**/*.{ts,tsx}',
      'apps/*/**/*.{ts,tsx}',
      'e2e/**/*.ts',
      'blocks/*/block.ts',
      // Root-level shared vitest config (#818) — real, load-bearing config that every
      // package's own vitest.config.ts re-exports, so it gets the same treatment as the
      // per-package tool configs rather than sitting outside the linted set entirely.
      'vitest.shared.ts'
    ],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // Auto-discovers the nearest tsconfig.json per file — including the small
        // blocks/tsconfig.json added alongside this config (blocks/<tag>/block.ts has
        // no package.json of its own; that tsconfig's `paths` redirect @setu/core + zod
        // to packages/core, mirroring how scripts/gen-blocks.mjs resolves them at
        // runtime via createRequire anchored on packages/core).
        projectService: {
          // vite.config.ts / vitest.config.ts sit at each package root but are
          // intentionally NOT in that package's own tsconfig `include` (they're
          // evaluated directly by Vite/Vitest's esbuild transform, not `tsc` — a
          // deliberate, repo-wide convention, not an oversight: every package with a
          // vitest.config.ts follows it identically). allowDefaultProject gives
          // projectService a single-file program for just these instead of erroring
          // "not found by the project service".
          // NOT apps/site/vitest.config.ts: site's tsconfig includes `**/*`, so its
          // config file IS in a real project already (projectService errors if a file
          // matches both).
          // apps/admin/vitest.browser.config.ts + vitest.config.ts (#293, renamed off
          // vitest.workspace.ts in #818; apps/api gained one too): same
          // "tool config outside the package's own tsconfig include" shape as the
          // vitest.config.ts convention above — apps/admin/tsconfig.json's `include`
          // is `["src", "test", "test-browser"]`, deliberately not the repo root, so
          // these two files need the same single-file-program treatment.
          // PACKAGE_VITEST_CONFIGS is derived above rather than globbed, so that
          // packages/theme-default (whose config file IS inside a real program) is left
          // out — see that block's comment for why a `!` glob cannot do this job.
          allowDefaultProject: [
            ...PACKAGE_VITEST_CONFIGS,
            'vitest.shared.ts',
            'apps/admin/vite.config.ts',
            'apps/admin/vitest.config.ts',
            'apps/admin/vitest.browser.config.ts',
            'apps/api/vitest.config.ts'
          ],
          // Every package follows this convention identically (a root-level tool config
          // outside its package's tsconfig), well over typescript-eslint's default cap of
          // 8 files. #818 gave the 9 remaining config-less packages and apps/api one each,
          // taking the match count from 20 to 28 — the old ceiling of exactly 20 then
          // FAILED the lint run outright ("Too many files (>20) have matched the default
          // project"), so it is raised with headroom for the next few packages. These are
          // tiny (~5-25 line) config files; the single-file-program cost per file is
          // negligible next to the type-aware program builds this repo already pays for
          // src/test. Opting into the explicit "THIS_WILL_SLOW_DOWN_LINTING" flag rather
          // than silently letting the guard reject the glob.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 40
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Repo has no noUnusedLocals/noUnusedParameters in tsconfig.base.json (tracked
      // separately as a tsconfig-strictness gap) — ESLint owns unused-vars instead, per
      // the issue's explicit direction. `_`-prefix is the existing repo convention for
      // intentionally-unused args/vars (grep shows dozens of pre-existing `(_, i) =>`
      // and `(_view, event)` callbacks) so it's the ignore pattern, not a new rule.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      // TUNED OFF (T2 decision, #267): 194 hits at baseline, every sampled one the same
      // legitimate pattern — an `async` function with no `await`, written to CONFORM to
      // an async Port interface or API signature. That's structural to the Ports &
      // Adapters architecture (docs/architecture.md): in-memory/testing/console adapters
      // (db-memory, git-memory, storage-testing, email-console, db-idb…) implement async
      // ports synchronously; prod code ships fail-closed async stubs (createNoopCaptcha,
      // apps/api server.ts `verify`); tests mock fetch/ports with `vi.fn(async () => …)`.
      // Sampled ~15 sites across src+test: zero real missing-awaits. A truly forgotten
      // await is still caught by no-floating-promises / no-misused-promises (both ON via
      // recommendedTypeChecked).
      '@typescript-eslint/require-await': 'off'
    }
  },

  // ---- Astro components (#819) ----
  // Until this block, `**/*.astro` sat in IGNORES and the ENTIRE public rendering path —
  // apps/site 12 files, packages/blocks 9, packages/theme-default 6, packages/image-astro 2,
  // repo-root blocks/ 5 — was read by no linter at all, while apps/site/test/a11y.test.ts
  // runs axe over exactly those rendered pages. `flat/recommended` brings astro-eslint-parser
  // (so the frontmatter script and the template are both parsed) plus the plugin's own rules;
  // `flat/jsx-a11y-recommended` layers the same accessibility rule set the admin already runs
  // onto the templates, which is where it matters most.
  // NOT type-aware: astro-eslint-parser can supply type information via
  // `parserOptions.project`, but no tsconfig in this repo has .astro files in its `include`
  // (apps/site's astro-generated tsconfig covers them through `.astro/types.d.ts`, not as
  // program roots), so requesting it would fail per-file rather than lint. Syntactic rules,
  // the astro rule set and jsx-a11y are what this block is for; the type-aware net still
  // stops at the .astro boundary and that is now a known, narrower gap rather than a total one.
  ...astro.configs['flat/recommended'],
  // The plugin ships jsx-a11y as `flat/jsx-a11y-recommended`, whose LAST entry declares the
  // `jsx-a11y` plugin with NO `files` key — i.e. globally. Flat config refuses two configs
  // that both define the same plugin name for the same file ("Cannot redefine plugin
  // 'jsx-a11y'"), which is exactly what happens against the admin block below, so that entry
  // is re-scoped to `**/*.astro` here instead of spread as-is. Everything but the plugin/rules
  // pair (parser, globals) already came from `flat/recommended` above.
  {
    files: ['**/*.astro'],
    ...astro.configs['flat/jsx-a11y-recommended'].at(-1)
  },

  // ---- Two tuned .astro a11y rules (#819) ----
  // The whole 35-file first-run baseline was THREE errors, so this is triage of named
  // sites, not a sweep. Both tunes are also applied to the .tsx side below where the same
  // rule fires on the same component.
  {
    files: ['**/*.astro'],
    rules: {
      // DOWNGRADED to warn, tracked as #826. packages/blocks/src/video/Video.astro renders
      // a user-supplied video URL and the block contract has NO captions field, so there is
      // no track file to point at — the only way to make this rule pass today is to emit an
      // empty <track>, which satisfies the linter while telling a screen-reader user a lie.
      // It is a genuine gap in the Video block, so it stays visible rather than off, and
      // #826 carries the contract + editor-control work that lets it go back to error.
      'astro/jsx-a11y/media-has-caption': 'warn',
      // NARROWED, not disabled. jsx-a11y's recommended `handlers` list for this rule includes
      // onLoad and onError, and packages/image-astro/src/Image.astro:38,43 puts an inline
      // `onload` on the blur-up <img> to add `is-loaded` once the full image decodes. `load`
      // is fired by the browser, never by a user, so it cannot be the "keyboard user can't
      // reach this" hazard the rule exists to catch — that is a false positive on this rule's
      // own terms. The interaction handlers it DOES catch (click/mouse/key on a non-
      // interactive element) all stay on.
      'astro/jsx-a11y/no-noninteractive-element-interactions': [
        'error',
        {
          handlers: [
            'onClick',
            'onMouseDown',
            'onMouseUp',
            'onKeyPress',
            'onKeyDown',
            'onKeyUp'
          ]
        }
      ]
    }
  },

  // ---- react-hooks (admin only) + jsx-a11y (admin AND the front-end render path) ----
  // The two plugins are declared in one block because flat config refuses to let two
  // configs define the same plugin name for the same file, and their file sets overlap.
  // react-hooks rules are then re-scoped OFF for the non-admin globs below — the front-end
  // packages are not bound to admin's React conventions (#267), only to its a11y bar (#819).
  {
    files: [
      'apps/admin/src/**/*.{ts,tsx}',
      'apps/admin/test/**/*.{ts,tsx}',
      'apps/admin/test-browser/**/*.{ts,tsx}',
      // #819: the public rendering path. `.astro` templates are covered separately by the
      // astro block above (different parser); these are the .tsx/.ts renderers that sit
      // beside them — packages/blocks' React block components and theme-default's helpers.
      'packages/theme-default/**/*.{ts,tsx}',
      'packages/blocks/**/*.{ts,tsx}'
    ],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y.flatConfigs.recommended.plugins['jsx-a11y']
    },
    languageOptions: jsxA11y.flatConfigs.recommended.languageOptions,
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // DOWNGRADED to warn (T2 decision, #267): react-hooks v7's React Compiler
      // diagnostics found ~30 REAL pre-existing issues in the admin (18×
      // set-state-in-effect — the exact cascading-render class that already bit the
      // editor once, see useSelectedBlock.ts's loop-guard comment — plus 8× refs, 3×
      // globals, purity/immutability/memoization singles). These are product findings,
      // not lint noise, but each needs an individual effect/ref refactor plus a
      // real-browser editor UAT pass (jsdom green ≠ editor safe — proven previously);
      // bulk-fixing them inside the linter increment would be reckless. They stay
      // visible as warnings; the error-gate upgrade happens when the follow-up issue
      // (filed with the per-site list) burns the backlog down.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/static-components': 'warn',
      // Same finding and same reasoning as the .astro tune above (#826): Video.tsx:59 is the
      // editor-canvas twin of Video.astro's <video>, blocked on the same missing captions
      // field in the block contract. Kept as a warning so the gap stays on screen.
      'jsx-a11y/media-has-caption': 'warn'
    }
  },

  // ---- ...and react-hooks back OFF for the front-end packages (#819) ----
  // The block above had to declare both plugins together (flat config forbids redefining a
  // plugin for the same file), but only jsx-a11y was in scope to widen. Turning every
  // react-hooks rule off here keeps #267's deliberate "themes are not bound to admin React
  // conventions" decision intact instead of quietly importing a second rule set with it.
  {
    files: [
      'packages/theme-default/**/*.{ts,tsx}',
      'packages/blocks/**/*.{ts,tsx}'
    ],
    rules: Object.fromEntries(
      Object.keys(reactHooks.configs.flat.recommended.rules).map((rule) => [
        rule,
        'off'
      ])
    )
  },

  // ---- Test files: relax the `any`-hygiene family (T2 decision, #267) ----
  // Mocks are structurally `any`-producing: vi.fn()/mock helpers, JSON.parse of
  // fixture payloads, expect.any(...), Tiptap/DOM probing. The unsafe-* rules fired
  // ~140 times in tests vs ~40 in src at baseline, and every sampled test hit was a
  // mock/fixture pattern, not a bug. Keeping these ON for src (where they found real
  // issues — see the T2 hand-fix commits) and OFF for tests keeps the signal without
  // fighting the test idiom. `unbound-method` is the canonical vitest/jest false
  // positive (`expect(obj.method)…` is exactly how you assert on spies).
  // packages/*-testing/src is included: those packages ARE shipped test harnesses
  // (contract suites + fixtures) and use expect.any() etc. in their source.
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/test/**/*.{ts,tsx}',
      // apps/admin/test-browser/** (#293): same test idiom (mocks, vi.fn(), DOM
      // probing) as apps/admin/test/**, just running in real chromium instead of
      // jsdom — not covered by the `test/**` glob above (different directory name).
      'apps/admin/test-browser/**/*.{ts,tsx}',
      'packages/*-testing/src/**/*.ts',
      // Tool configs linted via allowDefaultProject get a single-file program that
      // can't always resolve plugin package types (e.g. @tailwindcss/vite in admin's
      // vite.config.ts resolves to an error type there) — same relaxation applies.
      'packages/*/vitest.config.ts',
      'apps/*/vite.config.ts',
      'apps/*/vitest.config.ts',
      'apps/admin/vitest.browser.config.ts',
      'vitest.shared.ts'
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/unbound-method': 'off'
    }
  },

  // ---- Edge guard: Node imports/globals FAIL lint in edge-reachable core dirs (#434) ----
  // File list derived from packages/core/tsconfig.edge.json above. Colocated tests
  // (src/**/*.test.ts) are excluded — they run under vitest on Node and may legitimately
  // use node: modules; only shipped edge-reachable source is restricted.
  {
    files: edgeFiles,
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NODE_BUILTIN_PATHS,
          patterns: [{ regex: '^node:', message: NODE_BUILTIN_IMPORT_MESSAGE }]
        }
      ],
      'no-restricted-globals': [
        'error',
        ...['process', '__dirname', '__filename', 'Buffer', 'require'].map(
          (name) => ({
            name,
            message: `'${name}' is a Node global; this module is edge-reachable (packages/core/tsconfig.edge.json) and must run on Cloudflare Workers. Put Node-bound work behind a port/adapter instead (docs/architecture.md, "edge-safe core").`
          })
        )
      ]
    }
  },

  // ---- Non-type-aware base for loose root/config scripts (no tsconfig covers these) ----
  {
    files: [
      'scripts/*.mjs',
      '*.mjs',
      'apps/*/*.config.mjs',
      'apps/*/integrations/**/*.mjs'
    ],
    languageOptions: { globals: globals.node },
    rules: {
      // Same `_`-prefix convention as @typescript-eslint/no-unused-vars above.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },

  // ---- Global language options ----
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest }
    }
  },
  {
    files: ['apps/admin/src/**/*.{ts,tsx}', 'apps/site/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser }
    }
  },

  // ---- Prettier last: turn off any ESLint stylistic rule that would fight Prettier ----
  eslintConfigPrettier
)
