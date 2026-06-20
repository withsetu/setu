import { defineConfig } from './define-config'
import { resolveConfig } from './resolve'

/** The config Setu ships with when the developer provides none. Blocks are no longer
 *  listed here — they are auto-discovered from `blocks/<tag>/` folders (sub-project #4).
 *  This keeps only site-wide choices (theme, theme-options). */
export const defaultConfig = defineConfig({})

/** Known-block tag set from the default config — now empty (blocks come from the folder
 *  registry, injected at the call site). Kept as the converter's inert fallback. */
export const defaultKnownBlockTags = resolveConfig(defaultConfig).knownBlockTags
