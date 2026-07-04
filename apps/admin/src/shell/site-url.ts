import type { EntryRef, ResolvedPermalinkConfig } from '@setu/core'
import { entryUrlPath } from '@setu/core'

// Where the published site is served. Set per-environment via VITE_SETU_API's sibling
// VITE_SETU_SITE (the `pnpm dev` script points it at the local Astro server). Falls back to
// the local dev default so the links work out of the box.
const FALLBACK = 'http://localhost:4321'

export function siteBaseUrl(): string {
  return import.meta.env.VITE_SETU_SITE ?? FALLBACK
}

/** Absolute URL on the published site. No ref → the site home. With a ref → that entry's
 *  live page, using the shared @setu/core URL mapping so it matches what the site serves.
 *  `cfg` = the settings-resolved permalink config; omitted → legacy ':collection/:slug' scheme.
 *  NOT collision-aware (the admin can't see the whole build) — a disambiguated (-2) entry's
 *  link goes to the clean URL; acceptable edge, noted in epic #349. */
export function siteUrl(
  ref?: EntryRef & { date?: number | null; categories?: string[] },
  cfg?: ResolvedPermalinkConfig
): string {
  const base = siteBaseUrl().replace(/\/+$/, '')
  if (!ref) return base
  const path = entryUrlPath(ref, cfg)
  return path ? `${base}/${path}` : base
}
