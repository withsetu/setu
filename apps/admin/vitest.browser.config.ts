import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Real-browser component tests (#293). The historical bug this project exists to catch:
// BlockInspector wires a Radix Select/ToggleGroup rail to a live Tiptap editor
// (useSelectedBlock.ts); a first cut re-rendered on every ProseMirror transaction, and
// Radix's own portal-driven re-render/effect churn compounded that into an unbounded
// "Maximum update depth exceeded" loop that blanked the editor. jsdom-green tests missed
// it entirely — jsdom doesn't render Radix's `Portal` (document.body-appended content),
// doesn't lay out real focus/measurement, and `fireEvent` bypasses the browser's real
// event/paint loop. A regression for that bug class needs a REAL DOM: real portals, real
// focus, real paint — hence a browser-mode project alongside (not replacing) the jsdom
// suite in vite.config.ts.
//
// Same resolve aliases as vite.config.ts (block.ts files at repo-root blocks/ import bare
// "@setu/core"/"zod", resolved from wherever they're actually installed) — kept identical
// so anything importable in the jsdom project is importable here too.
const require = createRequire(import.meta.url)

// The browser suite mounts the real AppSidebar, which renders DevBadge, so this project still
// has to DEFINE `__SETU_DEV_BRANCH__` — DevBadge's `typeof` guard would fall back to '' anyway,
// but leaving the constant undefined here would mean the browser project compiles a different
// expression than either real build. It is pinned to the EMPTY STRING rather than the actual
// branch (#818): this config previously called `git branch --show-current` unconditionally, so
// the suite's compiled output — and any cache entry keyed off it — varied by which worktree
// happened to run it, while vite.config.ts:82-84 already zeroes the same constant for
// `command !== 'serve'`. '' is what a production build injects and what a test therefore should
// see; DevBadge renders nothing for a falsy branch, which no test asserts against today
// (grep: the constant appears only in env.d.ts and DevBadge.tsx).
export default defineConfig({
  define: { __SETU_DEV_BRANCH__: JSON.stringify('') },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@setu/core': require.resolve('@setu/core'),
      zod: require.resolve('zod')
    }
  },
  server: { fs: { allow: ['../..'] } },
  // Pre-bundle the browser suite's WHOLE dependency graph up front. Vitest browser
  // mode runs one Vite server for every test file and optimizes deps lazily: anything
  // the initial esbuild scan misses is discovered on first import while the browser is
  // already connected, and Vite responds with a full-page reload to swap in the newly
  // optimized bundle. If that reload lands mid-runner-init the tester loses its context
  // and the file fails to import with "Vitest failed to find the runner" — a flake that
  // only fires in CI (cold cache + parallel load widen the discover→reload window) while
  // every local run is green. It began when the block merges grew this graph and hit
  // slash-menu.test.tsx hardest: it pulls the full Tiptap editor core AND the block
  // registry, whose `import.meta.glob('blocks/*/block.ts')` (registry.ts) is invisible to
  // esbuild's pre-bundle scanner, so the deps those blocks reach through @setu/core
  // (@markdoc/markdoc, js-yaml, zod) are exactly what the scan intermittently under-counts.
  //
  // The fix that vitest confirms for this class (vitest-dev/vitest#9509 — "fixed by
  // finding the right combination of required deps in optimizeDeps.include") is to make
  // the first optimize authoritative: list every dep the browser tests actually load so
  // discovery — and therefore the reload — can never happen mid-run. This front-loads
  // work Vite would do during the run anyway; it is not net-extra bundling. Setu #589.
  //
  // Keep this list in sync when a browser test reaches a new dependency: the symptom of
  // a missing entry is exactly the #589 flake, not a hard failure.
  optimizeDeps: {
    include: [
      // React runtime — subpaths esbuild's auto-include misses, so they get discovered
      // on first render and reload the tester (the #589 trigger, caught locally).
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      // Test harness (never imported by src/).
      '@testing-library/react',
      '@testing-library/jest-dom',
      // Tiptap editor core — the slash-menu Harness + EditorScreen build a live editor.
      '@tiptap/core',
      '@tiptap/react',
      '@tiptap/react/menus',
      '@tiptap/starter-kit',
      '@tiptap/suggestion',
      '@tiptap/pm/state',
      '@tiptap/pm/tables',
      '@tiptap/extension-placeholder',
      '@tiptap/extension-subscript',
      '@tiptap/extension-superscript',
      '@tiptap/extension-list',
      '@tiptap/extension-table',
      '@tiptap/extension-text-align',
      'tippy.js',
      // Block registry graph — reached through the scanner-invisible import.meta.glob.
      '@markdoc/markdoc',
      'js-yaml',
      'zod',
      // App shell / UI kit pulled in by the full-screen tests (editor-viewonly-canvas
      // mounts the real EditorScreen: router, auth client, shadcn/radix controls).
      'react-router-dom',
      'better-auth/react',
      'better-auth/client/plugins',
      'radix-ui',
      'lucide-react',
      'class-variance-authority',
      'clsx',
      'tailwind-merge',
      'cmdk',
      'sonner',
      'next-themes',
      'motion/react',
      'date-fns',
      'react-day-picker',
      'react-dropzone',
      'idb',
      'diff'
    ]
  },
  test: {
    name: 'browser',
    globals: true,
    include: ['test-browser/**/*.test.{ts,tsx}'],
    // REAL BROWSER: each file boots a Vite server, launches chromium and mounts a live
    // React tree — for the heaviest specs that is the whole Tiptap editor plus the Radix
    // control rail (see the #589 note above on how much graph the first import pulls).
    // vitest's 5s default was never sized for that: it covers browser launch + connect +
    // first-paint before a single assertion runs, and a cold CI runner with no warmed
    // esbuild cache is exactly where it bites (#818; related flakes #718, #684, #636).
    // 30s/60s is a hang gate for a suite whose warm local runs are ~1-3s per file, not a
    // blanket raise — the jsdom project next door deliberately keeps the 5s default.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // No setupFiles here on purpose: apps/admin/test/setup.ts polyfills jsdom gaps
    // (document.elementFromPoint, Range.getClientRects, matchMedia) that a real browser
    // already implements correctly — porting it in would silently shadow real behavior
    // instead of exercising it.
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      // vitest 3 replaced the single-instance `name: 'chromium'` with an `instances[]`
      // array (one Vite server serves all instances — better caching than the old
      // workspace split). CI's Playwright browser cache (.github/workflows/ci.yml)
      // already covers chromium; this reuses that same binary rather than a second
      // browser-install step.
      instances: [
        { browser: 'chromium', viewport: { width: 1280, height: 800 } }
      ]
    }
  }
})
