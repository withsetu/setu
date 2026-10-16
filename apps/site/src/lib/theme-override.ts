/**
 * Write the theme-options override into a rendered page's <head> (#1294).
 *
 * Inserted immediately before `</head>`, i.e. after every stylesheet the theme and Astro put in
 * the head, so the theme's base CSS loads first and the override follows it. It wins on
 * specificity as well (`optionsToCss` emits `:root:root`, 0,0,2,0, against the theme's plain
 * `:root`), so order is not what the cascade relies on.
 *
 * `css` is `optionsToCss` output over a declaration `parseThemeOptions` accepted, which refuses
 * `<` in every emitted value, so it cannot close the <style> element. Pure.
 *
 * A page with no `</head>` throws rather than shipping without the override: silently inert
 * Customizer controls are the defect this replaces. Enforced by
 * apps/site/test/theme-override.test.ts.
 */
export function withThemeOverride(
  html: string,
  css: string,
  where: string
): string {
  const at = html.indexOf('</head>')
  if (at === -1)
    throw new Error(
      `[setu] ${where}: the theme rendered no </head>, so the theme options override cannot be applied`
    )
  return `${html.slice(0, at)}<style>${css}</style>${html.slice(at)}`
}
