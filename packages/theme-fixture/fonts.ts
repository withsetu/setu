// Which `@fontsource-variable/*` package backs each `typeface` choice (see ./options.ts), plus
// the mono face for code, which is always bundled. The site bundles ONLY the selected family and
// the mono face (through the `virtual:setu-fonts` module), never every family offered here.
// That the choices and this map agree is enforced by packages/theme-fixture/fonts.test.ts.

/** `typeface` choice value → its fontsource package. */
export const FONT_PACKAGES: Record<string, string> = {
  fraunces: '@fontsource-variable/fraunces',
  literata: '@fontsource-variable/literata',
  bricolage: '@fontsource-variable/bricolage-grotesque'
}

/** Mono face for `--font-mono` (code). Not a `typeface` choice; always bundled. */
export const MONO_FONT_PACKAGE = '@fontsource-variable/fira-code'

/** The default `typeface` choice. */
export const DEFAULT_TYPEFACE = 'fraunces'

/** The packages the build should bundle for a `typeface` choice: that family plus mono. An
 *  unknown or missing choice falls back to the default family, never to an empty set. */
export function fontPackagesFor(choice: string | undefined): string[] {
  const family = FONT_PACKAGES[choice ?? ''] ?? FONT_PACKAGES[DEFAULT_TYPEFACE]!
  return [family, MONO_FONT_PACKAGE]
}
