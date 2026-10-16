import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { resolveThemeTokens } from '@setu/core'
import { useServices } from '../data/store'
import { useCan } from '../auth/actor'
import { useNotify } from '../ui/notify'
import {
  fetchThemeDeclaration,
  readPublishedThemeValues
} from '@/lib/theme-options'

/** The layout-axis contract tokens (packages/blocks/src/tokens.ts) the canvas sizes blocks by. */
const MEASURE_TOKENS = ['--measure-post', '--measure-page'] as const

/**
 * The active theme's PUBLISHED measures, as inline custom properties for the editor canvas (#1296).
 *
 * The canvas used to hardcode `--measure-page: 64rem`, so on Content width = Wide an author
 * composed Wide/Full blocks against the wrong measure while the Customizer's preview tracked it.
 * This resolves the measures exactly as the site does — the theme's declaration plus the committed
 * theme-options.json through `resolveThemeTokens` — using the Customizer's own read path
 * (src/lib/theme-options.ts). Published, not the Customizer's unpublished draft, because the
 * canvas should match what the site and the preview iframe render.
 *
 * `undefined` until resolved, and for an actor who cannot read the declaration (it is gated on
 * `theme.manage`): the canvas then falls back to the contract defaults from
 * @setu/blocks/tokens.css. Only measures the theme DECLARES as options are returned; a measure a
 * theme fixes in its own CSS cannot be read from the admin and stays at the contract default.
 * Behaviour: apps/admin/test-browser/editor-canvas-measure.test.tsx.
 */
export function useThemeMeasure(): CSSProperties | undefined {
  const { git } = useServices()
  const can = useCan()
  const notify = useNotify()
  const canReadTheme = can('theme.manage')
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined)

  useEffect(() => {
    if (!canReadTheme) return
    let live = true
    void (async () => {
      try {
        const options = await fetchThemeDeclaration()
        const values = await readPublishedThemeValues(git, options)
        const tokens = resolveThemeTokens(options, values)
        const measures: Record<string, string> = {}
        for (const t of MEASURE_TOKENS) {
          const v = tokens[t]
          if (v !== undefined) measures[t] = v
        }
        if (live) setStyle(measures)
      } catch (err) {
        if (!live) return
        // Not a blocking failure — the canvas still edits at the default width — but the author
        // is composing Wide/Full blocks against a measure that may not be the site's, so say so.
        console.error('[editor] reading the theme content width failed', err)
        notify.error(
          "Couldn't read your theme's content width, so the editor is showing the default width."
        )
      }
    })()
    return () => {
      live = false
    }
  }, [canReadTheme, git, notify])

  return style
}
