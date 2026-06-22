import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// block.ts files at the repo-root blocks/ folder are glob-imported into the
// admin bundle. Vite resolves their imports from *their* on-disk location
// (repo root), not from apps/admin, so bare specifiers like "@setu/core" and
// "zod" would fail. We anchor resolution here — at the admin package — using
// require.resolve so the paths track the real installed locations regardless of
// pnpm deduplication or hoisting decisions.
const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@setu/core': require.resolve('@setu/core'),
      'zod': require.resolve('zod'),
    },
  },
  server: { fs: { allow: ['../..'] } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
