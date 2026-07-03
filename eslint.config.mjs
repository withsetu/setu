// Setu root ESLint flat config (#267 T1).
//
// Scope decisions (see issue #267 for the full plan):
//  - Type-aware typescript-eslint via `projectService` — auto-discovers the nearest
//    tsconfig.json per file instead of us hand-listing all 26 package tsconfigs.
//  - react-hooks + jsx-a11y are scoped to `apps/admin/**` ONLY. Themes/site and shared
//    block components render on the front end and are deliberately NOT bound to admin
//    conventions (see CLAUDE.md "Admin vs. front-end themes") — they get base TS rules
//    only, even where they happen to use JSX (packages/blocks, packages/email-templates).
//  - `.astro` files are NOT linted in this increment — astro-eslint tooling is out of
//    scope for T1 (documented exclusion, revisit in a follow-up issue if desired).
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
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
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
  // Not TS/JS — out of scope for this increment (see header comment)
  '**/*.astro'
]

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
      'blocks/*/block.ts'
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
          allowDefaultProject: [
            'packages/*/vitest.config.ts',
            'apps/admin/vite.config.ts'
          ],
          // 17 packages follow this convention identically (verified by grep — every
          // vitest.config.ts in the repo is a root-level tool config outside its
          // package's tsconfig), well over typescript-eslint's default cap of 8 files.
          // These are tiny (~5-15 line) config files; the single-file-program cost per
          // file is negligible next to the type-aware program builds this repo already
          // pays for src/test. Opting into the explicit "THIS_WILL_SLOW_DOWN_LINTING"
          // flag rather than silently letting the guard reject the glob.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20
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

  // ---- react-hooks + jsx-a11y, admin ONLY (per #267 scope) ----
  {
    files: ['apps/admin/src/**/*.{ts,tsx}', 'apps/admin/test/**/*.{ts,tsx}'],
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
      'react-hooks/static-components': 'warn'
    }
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
      'packages/*-testing/src/**/*.ts',
      // Tool configs linted via allowDefaultProject get a single-file program that
      // can't always resolve plugin package types (e.g. @tailwindcss/vite in admin's
      // vite.config.ts resolves to an error type there) — same relaxation applies.
      'packages/*/vitest.config.ts',
      'apps/*/vite.config.ts'
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
