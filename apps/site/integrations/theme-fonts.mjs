// Resolve the ACTIVE theme's font imports for the `virtual:setu-fonts` module (#1075).
//
// This used to be gated on the theme's package NAME:
//
//   if (activeTheme === '@setu/theme-default') { … }
//
// so every other theme fell straight past it and got no fonts at all — the site built, rendered,
// and looked wrong with nothing saying why. Themes are installable (#342), so nothing outside a
// theme may name one particular theme.
//
// The two failure cases are kept apart on purpose. A theme with no `./fonts` export is a
// legitimate theme and must build — but it is ANNOUNCED, because a silent empty result is
// indistinguishable from the bug this replaces. A theme whose fonts module is broken is a broken
// theme and must fail loudly rather than degrade to no fonts.
//
// Behaviour is covered by apps/site/test/theme-fonts.test.ts.

/** True when `err` means "this package has no such subpath", as opposed to "something inside
 *  that module failed to load". Node reports the first as ERR_PACKAGE_PATH_NOT_EXPORTED; it
 *  reports the second as ERR_MODULE_NOT_FOUND *naming a different specifier*, which is why the
 *  message is checked against the specifier we actually asked for rather than trusting the code
 *  alone — otherwise a theme with a typo'd font dependency would look like a theme with no
 *  fonts, and ship silently. */
function isMissingExport(err, specifier) {
  if (err?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return true
  if (err?.code !== 'ERR_MODULE_NOT_FOUND') return false
  return String(err.message).includes(specifier)
}

/**
 * @param {string} activeTheme    Package name of the configured theme.
 * @param {string|undefined} fontChoice  The selected family (Customizer / setu.config).
 * @param {{
 *   importModule: (specifier: string) => Promise<unknown>,
 *   resolvePackageFile: (pkg: string, fromTheme: string) => string,
 *   logger: { info: (msg: string) => void, warn: (msg: string) => void }
 * }} deps
 * @returns {Promise<string>} Import statements for the virtual module; '' when the theme ships none.
 */
export async function themeFontImports(activeTheme, fontChoice, deps) {
  const specifier = `${activeTheme}/fonts`
  let mod
  try {
    mod = await deps.importModule(specifier)
  } catch (err) {
    if (isMissingExport(err, specifier)) {
      deps.logger.info(
        `[setu] theme ${activeTheme} ships no fonts (no "./fonts" export) — none will be bundled`
      )
      return ''
    }
    throw err
  }

  const { fontPackagesFor } = mod ?? {}
  if (typeof fontPackagesFor !== 'function') {
    // Present but unusable: a broken theme, not a font-less one.
    throw new Error(
      `[setu] theme ${activeTheme} exports "./fonts" but no fontPackagesFor() — cannot resolve its fonts`
    )
  }

  // Only the SELECTED family (plus mono) is bundled, never every family the theme offers.
  return fontPackagesFor(fontChoice)
    .map(
      (pkg) =>
        `import ${JSON.stringify(deps.resolvePackageFile(pkg, activeTheme))};`
    )
    .join('\n')
}
