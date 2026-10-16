import { describe, expect, it } from 'vitest'
import { withThemeOverride } from '../src/lib/theme-override'

// #1294: Setu, not the theme, writes the theme-options override into every page.
describe('withThemeOverride', () => {
  const css = ':root:root { --accent: #0ea5e9; }'

  it('puts the override last in <head>, after the stylesheets it must follow', () => {
    const html =
      '<html><head><link rel="stylesheet" href="/t.css"><style>.a{}</style></head><body></body></html>'
    expect(withThemeOverride(html, css, '/x')).toBe(
      `<html><head><link rel="stylesheet" href="/t.css"><style>.a{}</style><style>${css}</style></head><body></body></html>`
    )
  })

  it('touches only the first </head>', () => {
    const html = '<head></head><body><pre>&lt;/head&gt; </head></pre></body>'
    const out = withThemeOverride(html, css, '/x')
    expect(out.indexOf(css)).toBe('<head>'.length + '<style>'.length)
    expect(out.split(css)).toHaveLength(2)
  })

  it('fails loudly, naming the page, when the theme rendered no </head>', () => {
    expect(() => withThemeOverride('<body>hi</body>', css, '/post/a/')).toThrow(
      /\/post\/a\/.*no <\/head>/
    )
  })
})
