import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// #1296: the Wide / Full width primitives and the `.setu-post-card__*` internals are owned by
// @setu/blocks/base.css, not re-implemented per theme. This theme loads that base FIRST (so its
// own tokens and any restyle layer after it) and keeps no second copy of the rules — a copy here
// would silently drift from the base the next time one of them changes.

const read = (f: string) =>
  readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('theme-default layers on @setu/blocks/base.css (#1296)', () => {
  it('theme.css imports the base layer before any rule of its own', () => {
    const css = stripComments(read('./theme.css')).trim()
    expect(css.startsWith("@import '@setu/blocks/base.css';")).toBe(true)
  })

  it.each(['./theme.css', './site.css'])(
    '%s re-implements none of the shared width primitives or card internals',
    (file) => {
      const css = stripComments(read(file))
      const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1] ?? '')
      const owned = selectors.filter((s) =>
        /\.(?:w|align)-(?:wide|full)\b|\.setu-post-card__|\.setu-posts__empty/.test(
          s
        )
      )
      expect(owned).toEqual([])
    }
  )
})
