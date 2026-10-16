import type { GitPort, ThemeOption } from '@setu/core'
import { apiFetch } from './api-fetch'

/** The committed file the site reads (content-repo root); see apps/site/src/lib/site-config.ts. */
export const THEME_OPTIONS_PATH = 'theme-options.json'

/** Every option at its declared default — the live state when nothing has been published. */
export function themeDefaults(options: ThemeOption[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.key, o.default]))
}

/**
 * The ACTIVE theme's option declaration, read from the API (#1076).
 *
 * The admin is a browser bundle and cannot import an installed theme's module, so the server reads
 * the declaration and serves it (apps/api/src/theme-api.ts, gated on `theme.manage`). Shared by the
 * Customizer and the editor canvas (#1296) so both resolve tokens from the same declaration.
 * Rejects on any failure — a caller must report it, never treat it as "this theme declares none".
 */
export async function fetchThemeDeclaration(): Promise<ThemeOption[]> {
  // apiFetch only adds credentials — it does NOT prepend the API origin, so the base is composed
  // here as every other admin->API call does. Read per call so a test can stub the env.
  const apiBase = import.meta.env.VITE_SETU_API ?? ''
  const res = await apiFetch(`${apiBase}/api/theme/options`)
  if (!res.ok) throw new Error(`theme options responded ${res.status}`)
  const body = (await res.json()) as { options?: unknown }
  if (!Array.isArray(body?.options))
    throw new Error('theme options response had no options list')
  return body.options as ThemeOption[]
}

/**
 * The PUBLISHED option values — what the live site renders — merged over the declared defaults.
 *
 * Only `git.readFile` can reject (the caller reports that). A missing or malformed committed file
 * is not a failure: the live state is then the theme defaults, which is what the site builds.
 */
export async function readPublishedThemeValues(
  git: Pick<GitPort, 'readFile'>,
  options: ThemeOption[]
): Promise<Record<string, string>> {
  const raw = await git.readFile(THEME_OPTIONS_PATH)
  const defaults = themeDefaults(options)
  if (!raw) return defaults
  try {
    return { ...defaults, ...(JSON.parse(raw) as Record<string, string>) }
  } catch {
    return defaults
  }
}
