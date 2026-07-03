// Which `@fontsource-variable/*` package backs each `font` theme-option choice (see the `font`
// option in ./options.ts) — plus the mono font, always bundled for code. The site build bundles
// ONLY the selected family + mono (via the `virtual:setu-fonts` module), instead of all of them.

/** `font` choice value → its fontsource package. Keys MUST match the `font` option choices. */
export const FONT_PACKAGES: Record<string, string> = {
  grotesk: '@fontsource-variable/hanken-grotesk',
  inter: '@fontsource-variable/inter',
  'source-serif': '@fontsource-variable/source-serif-4',
  newsreader: '@fontsource-variable/newsreader',
  lora: '@fontsource-variable/lora',
  space: '@fontsource-variable/space-grotesk'
}

/** Mono font for `--font-mono` (code) — not a `font` choice, always loaded. */
export const MONO_FONT_PACKAGE = '@fontsource-variable/jetbrains-mono'

/** The default `font` choice (matches the `font` option's default in ./options.ts). */
export const DEFAULT_FONT = 'grotesk'

/** Resolve a `font` choice to the packages the build should bundle: the chosen family + mono.
 *  An unknown/missing choice falls back to the default family — never an empty set. */
export function fontPackagesFor(fontChoice: string | undefined): string[] {
  const family = FONT_PACKAGES[fontChoice ?? ''] ?? FONT_PACKAGES[DEFAULT_FONT]!
  return [family, MONO_FONT_PACKAGE]
}
