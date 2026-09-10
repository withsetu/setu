import { defineConfig } from './define-config'
import { resolveConfig } from './resolve'

/** The config Setu ships with when the developer provides none. Blocks are no longer
 *  listed here — they are auto-discovered from `blocks/<tag>/` folders (sub-project #4).
 *  This keeps only site-wide choices (theme, theme-options). */
export const defaultConfig = defineConfig({})

/** Known-block tag set from the default config — now empty (blocks come from the folder
 *  registry, injected at the call site). Kept as the converter's inert fallback. */
export const defaultKnownBlockTags = resolveConfig(defaultConfig).knownBlockTags

/** The theme used when `setu.config` names none.
 *
 *  Exported so exactly ONE module names the built-in theme. Before #1076 the string was repeated
 *  at each fallback site, which is the same shape as the hardcodes that made themes un-installable
 *  (#342) — a default VALUE is fine; a default scattered across call sites drifts. */
export const DEFAULT_THEME = '@setu/theme-default'
