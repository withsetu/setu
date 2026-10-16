// Setu applies the active theme's options; the theme does not (#1294).
//
// The `:root:root { … }` override that makes every Customizer control take effect used to be
// emitted by theme-default's own Layout. A theme that left that call out still built, still
// rendered, and shipped every control inert — while the Customizer preview (which resolves tokens
// generically) and Publish both reported success. So the override is now applied by the site,
// around whatever the theme renders, and a theme only ships the declaration.
//
// Two halves:
//   1. `loadThemeDeclaration` reads `<theme>/options` at config time and validates it with
//      `parseThemeOptions` — the same check the API's /api/theme/options runs — so a bad
//      declaration fails `astro build` naming the option, instead of the build shipping broken
//      CSS while the admin shows a 500 on the same theme.
//   2. `themeOptionsOverride` serves the validated declaration as `setu:theme-options` and
//      registers the middleware (src/lib/theme-options-middleware.ts) that writes the override
//      into every HTML page's <head>.
//
// Behaviour is covered by apps/site/test/theme-options-declaration.test.ts (loading and
// validation), apps/site/test/theme-options.test.ts (the override reaches a built page of a theme
// that never calls optionsToCss) and apps/site/test/theme-options-invalid-build.test.ts (a bad
// declaration fails `astro build`).

/** "This package has no `./options` export", as opposed to "the options module failed to load".
 *  Same distinction as integrations/theme-fonts.mjs: the message must name the specifier we asked
 *  for, or a theme whose options module has a broken import would pass as a theme with none. */
function isMissingExport(err, specifier) {
  if (err?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return true
  if (err?.code !== 'ERR_MODULE_NOT_FOUND') return false
  return String(err.message).includes(specifier)
}

/**
 * @param {string} activeTheme  Package name (or directory) of the configured theme.
 * @param {{
 *   importModule: (specifier: string) => Promise<unknown>,
 *   parse: (raw: unknown) => unknown[],
 *   logger: { info: (msg: string) => void }
 * }} deps
 * @returns {Promise<unknown[]>} The validated declaration; [] for a theme with nothing to customise.
 */
export async function loadThemeDeclaration(activeTheme, deps) {
  const specifier = `${activeTheme}/options`
  let mod
  try {
    mod = await deps.importModule(specifier)
  } catch (err) {
    if (isMissingExport(err, specifier)) {
      // Legitimate, but announced: a silent [] is indistinguishable from a lost declaration.
      deps.logger.info(
        `[setu] theme ${activeTheme} declares no options (no "./options" export) — the Customizer has nothing to apply`
      )
      return []
    }
    throw err
  }
  try {
    return deps.parse(mod?.themeOptions)
  } catch (err) {
    throw new Error(
      `[setu] theme ${activeTheme} has an invalid options declaration — ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    )
  }
}

/**
 * @param {unknown[]} declaration  Output of `loadThemeDeclaration` (already validated).
 * @returns {import('astro').AstroIntegration}
 */
export function themeOptionsOverride(declaration) {
  const source = `export const themeOptions = ${JSON.stringify(declaration)}\n`
  return {
    name: 'setu:theme-options',
    hooks: {
      'astro:config:setup': ({ addMiddleware, updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'setu:virtual-theme-options',
                resolveId: (id) =>
                  id === 'setu:theme-options' ? '\0setu:theme-options' : null,
                load: (id) => (id === '\0setu:theme-options' ? source : null)
              }
            ]
          }
        })
        // 'pre' = outermost, so the rewrite sees the page exactly as everything else left it.
        addMiddleware({
          entrypoint: new URL(
            '../src/lib/theme-options-middleware.ts',
            import.meta.url
          ),
          order: 'pre'
        })
      }
    }
  }
}
