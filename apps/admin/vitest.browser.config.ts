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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@setu/core': require.resolve('@setu/core'),
      zod: require.resolve('zod')
    }
  },
  server: { fs: { allow: ['../..'] } },
  // Pre-bundle test-only deps up front — without this Vite discovers them mid-run (on
  // first import) and reloads, which vitest's browser runner logs as "unexpectedly
  // reloaded a test" and warns can cause flaky/duplicated runs. Both are test-only
  // (never imported by src/), so they're listed here rather than in `optimizeDeps`
  // for the whole app.
  optimizeDeps: {
    include: [
      '@testing-library/react',
      '@testing-library/jest-dom',
      '@tiptap/suggestion',
      'tippy.js'
    ]
  },
  test: {
    name: 'browser',
    globals: true,
    include: ['test-browser/**/*.test.{ts,tsx}'],
    // No setupFiles here on purpose: apps/admin/test/setup.ts polyfills jsdom gaps
    // (document.elementFromPoint, Range.getClientRects, matchMedia) that a real browser
    // already implements correctly — porting it in would silently shadow real behavior
    // instead of exercising it.
    browser: {
      enabled: true,
      provider: 'playwright',
      // vitest 2.1.x's browser config is single-instance (`name`, not the `instances[]`
      // array vitest 3 introduced) — this repo is on vitest ^2.1.8; verified against the
      // installed @vitest/browser@2.1.9 type definitions before writing this file.
      name: 'chromium',
      headless: true,
      // CI's Playwright browser cache (.github/workflows/ci.yml e2e job) already covers
      // chromium; this project reuses that same cache key/binary rather than a second
      // browser-install step.
      viewport: { width: 1280, height: 800 }
    }
  }
})
