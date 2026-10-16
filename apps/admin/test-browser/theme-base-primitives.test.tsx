import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from 'vitest/browser'
// The ONLY stylesheet under test: no theme CSS at all, so everything below that works is owed to
// @setu/blocks' base layer (#1296), not to a theme re-implementing it.
import '@setu/blocks/base.css'

// ---------------------------------------------------------------------------------
// #1296 — a theme sets the measure tokens and gets working Wide / Full and styled post cards
// without writing a single breakout or card rule. jsdom has no layout engine, so a "does it
// break out" assertion there would be vacuous; this runs in real chromium and measures boxes.
//
// The "theme" here is two custom properties plus the one content-link rule every theme has
// (`.prose a`) — included because it is the rule the card titles must out-specify, which is the
// only cascade interaction the base layer has to win on its own.
// ---------------------------------------------------------------------------------

const MINIMAL_THEME = `
  :root { --measure-post: 30rem; --measure-page: 50rem; }
  body { margin: 0; }
  .prose a { color: rgb(255, 0, 0); text-decoration: underline; }
`

afterEach(cleanup)
beforeEach(async () => {
  await page.viewport(1600, 900)
})

function renderPage() {
  return render(
    <>
      <style>{MINIMAL_THEME}</style>
      <article
        className="prose"
        style={{ maxWidth: 'var(--measure-post)', margin: '0 auto' }}
      >
        <p data-testid="column">Body text sits in the reading column.</p>
        <section className="blk-hero w-wide" data-testid="hero-wide">
          Wide hero
        </section>
        <section className="blk-video w-full" data-testid="video-full">
          Full video
        </section>
        <section className="blk-section w-full" data-testid="section-full">
          Full section
        </section>
        <figure className="setu-image align-wide" data-testid="image-wide">
          <img
            alt=""
            width={10}
            height={10}
            src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
          />
        </figure>
        <ul className="setu-posts">
          <li className="setu-post-card">
            <a className="setu-post-card__title" href="#post">
              A post title
            </a>
            <time className="setu-post-card__date">Oct 16, 2026</time>
          </li>
        </ul>
      </article>
    </>
  )
}

const box = (testId: string) =>
  (page.getByTestId(testId).element() as HTMLElement).getBoundingClientRect()

const rem = (n: number) =>
  n * parseFloat(getComputedStyle(document.documentElement).fontSize)

describe('@setu/blocks base layer on a theme that only sets the measures (#1296)', () => {
  it('Wide breaks out to --measure-page, centred on the column', () => {
    renderPage()
    const column = box('column')
    const wide = box('hero-wide')
    expect(column.width).toBeCloseTo(rem(30), 0)
    expect(wide.width).toBeCloseTo(rem(50), 0)
    expect(wide.left + wide.width / 2).toBeCloseTo(
      column.left + column.width / 2,
      0
    )
  })

  it('Full bleeds to the viewport width', () => {
    renderPage()
    const vw = document.documentElement.clientWidth
    for (const id of ['video-full', 'section-full']) {
      const full = box(id)
      // 100vw — allow the scrollbar gutter, if the runner draws one.
      expect(full.width).toBeGreaterThanOrEqual(vw)
      expect(full.left).toBeLessThanOrEqual(1)
    }
  })

  it('a Wide image fills its band', () => {
    renderPage()
    const fig = box('image-wide')
    const img = (
      page.getByTestId('image-wide').element() as HTMLElement
    ).querySelector('img') as HTMLImageElement
    expect(fig.width).toBeCloseTo(rem(50), 0)
    expect(img.getBoundingClientRect().width).toBeCloseTo(fig.width, 0)
  })

  it('post-card titles are styled cards, not underlined content links', () => {
    renderPage()
    const title = page.getByText('A post title').element() as HTMLElement
    const s = getComputedStyle(title)
    expect(s.textDecorationLine).toBe('none')
    // --text from the base token layer (#1a1a1f), not the theme's red link colour.
    expect(s.color).toBe('rgb(26, 26, 31)')
    expect(s.fontWeight).toBe('600')
    const date = page.getByText('Oct 16, 2026').element() as HTMLElement
    expect(getComputedStyle(date).display).toBe('block')
  })
})
