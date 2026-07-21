import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// block.ts files at the repo-root blocks/ folder are glob-imported into the
// admin bundle. Vite resolves their imports from *their* on-disk location
// (repo root), not from apps/admin, so bare specifiers like "@setu/core" and
// "zod" would fail. We anchor resolution here — at the admin package — using
// require.resolve so the paths track the real installed locations regardless of
// pnpm deduplication or hoisting decisions.
const require = createRequire(import.meta.url)

// #779: the browser cannot read git, so the branch this dev server is serving is injected at
// config time. `vite build` gets the EMPTY STRING — the branch name (and with it any hint of the
// developer's worktree layout) is physically absent from a production bundle, independently of the
// `import.meta.env.DEV` guard that drops the badge itself. One `git` call at startup, cached by
// vite for the process lifetime.
function currentBranch(): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
  } catch {
    return '' // not a git checkout (a tarball install, CI export) — badge simply does not render
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@setu/core': require.resolve('@setu/core'),
      zod: require.resolve('zod')
    }
  },
  server: { fs: { allow: ['../..'] } },
  build: {
    rollupOptions: {
      output: {
        // Cache-stability split (#597). Route-level `lazy()` already carves the
        // screens apart; this pulls the ONE dependency group that never changes
        // between Setu deploys — the React runtime and its router — out of the
        // entry chunk so a normal app-code release doesn't force every user to
        // re-download ~75 kB gzipped of unchanged framework.
        //
        // Deliberately a single explicit group, not a per-package split: bucketing
        // every node_modules folder into its own chunk was measured (100+ chunks)
        // and trades one cheap download for a request storm, and hand-grouping
        // interdependent libraries (radix/tiptap/prosemirror) risks the classic
        // manualChunks circular-init crash. Everything else keeps rollup's own
        // reachability-derived chunking, which already follows the lazy routes.
        //
        // Matching on `/node_modules/<pkg>/` (the INNERMOST segment) is required
        // under pnpm, whose real paths look like
        // node_modules/.pnpm/react-dom@19.2.7_react@19.2.7/node_modules/react-dom/…
        manualChunks(id: string) {
          if (
            /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(
              id
            )
          ) {
            return 'react-vendor'
          }
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}']
  },
  define: {
    __SETU_DEV_BRANCH__: JSON.stringify(
      command === 'serve' ? currentBranch() : ''
    )
  }
}))
