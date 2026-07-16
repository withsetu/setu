import { describe, it, expect } from 'vitest'
import { htmlToMarkdown, htmlToText } from '../src/aic/html-to-markdown'

// AIC descriptions are simple HTML (verified 2026-07-16 on live records:
// <p>, <em>, <strong>, <a href>, occasional lists). The converter only needs
// to cover that vocabulary honestly and strip anything else.
describe('htmlToMarkdown', () => {
  it('converts paragraphs to blank-line-separated markdown', () => {
    expect(htmlToMarkdown('<p>One.</p><p>Two.</p>')).toBe('One.\n\nTwo.')
  })

  it('converts emphasis, strong, and links', () => {
    expect(
      htmlToMarkdown(
        '<p>An <em>etching</em> of <strong>note</strong>, see <a href="https://example.org/x">the study</a>.</p>'
      )
    ).toBe('An *etching* of **note**, see [the study](https://example.org/x).')
  })

  it('converts list items to dashes', () => {
    expect(htmlToMarkdown('<p>Has:</p><ul><li>one</li><li>two</li></ul>')).toBe(
      'Has:\n\n- one\n- two'
    )
  })

  it('converts <br> to a line break and strips unknown tags', () => {
    expect(htmlToMarkdown('<p>a<br/>b <span>c</span></p>')).toBe('a\nb c')
  })

  it('decodes common entities', () => {
    expect(
      htmlToMarkdown('<p>Arts &amp; Crafts &#8212; d&#xE9;cor&nbsp;!</p>')
    ).toBe('Arts & Crafts — décor !')
  })
})

describe('htmlToText', () => {
  it('strips all markup and collapses whitespace', () => {
    expect(
      htmlToText('<p>An <em>etching</em>   of\n<strong>note</strong>.</p>')
    ).toBe('An etching of note.')
  })

  it('returns an empty string for empty/whitespace HTML', () => {
    expect(htmlToText('')).toBe('')
    expect(htmlToText('<p>   </p>')).toBe('')
  })
})
