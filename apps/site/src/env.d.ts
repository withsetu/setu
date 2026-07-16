/// <reference types="astro/client" />

// Custom env vars read via `import.meta.env.*` (see apps/site/src/lib/rss-xml.ts,
// pages/*.astro, preview/preview.astro) had no declaration anywhere in the repo — every
// read of PUBLIC_SETU_MEDIA / SETU_API_URL silently typed as `any` and passed unchecked
// into typed function params. typescript-eslint's `no-unsafe-argument` caught this
// (bringing #267's type-aware linting online); this is the missing declaration.
interface ImportMetaEnv {
  /** Public origin serving uploaded media (client + server); see @setu/image-astro's
   *  resolveMediaBase. Falls back to http://localhost:4444 in dev when unset. */
  readonly PUBLIC_SETU_MEDIA?: string
  /** The @setu/api origin the live-preview bridge polls. Falls back to
   *  http://localhost:4444 when unset (see preview/preview.astro). */
  readonly SETU_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Vite alias (see astro.config.mjs) resolving repo-root `blocks/*.astro` bare-specifier imports
// to this app's collision-aware permalink map, without blocks importing site libs by relative
// path. Declared here (rather than inferred from the aliased file) because `tsc` never resolves
// bundler-only virtual/aliased specifiers on its own.
declare module 'setu:permalinks' {
  export function permalinkMap(): Promise<Map<string, string>>
}

// Companion alias (see astro.config.mjs): the shared entry→PostRow projection for
// dynamic block renderers.
declare module 'setu:post-row' {
  export function toPostRow(
    entry: { id: string; data: Record<string, unknown>; body?: string },
    urlPath?: string
  ): import('@setu/core').PostRow
}
