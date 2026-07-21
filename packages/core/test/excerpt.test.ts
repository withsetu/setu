import { describe, it, expect } from 'vitest'
import { excerpt } from '../src/content/excerpt'

/** #787. `excerpt()` output is not decoration — it is the RSS `<description>`
 *  (apps/site/src/lib/feed.ts) and the post-card/meta description. The strip list grew
 *  case by case and never covered block-level table syntax, so an entry that opens with
 *  a table published its pipes, its `| --- |` delimiter row and the `<br>` from a folded
 *  multi-block cell (#752) straight into the feed. */
describe('#787 — excerpt() strips block-level table syntax', () => {
  it('produces clean prose for an entry that opens with a table', () => {
    const body = [
      '| Feature | Notes |',
      '| --- | :---: |',
      '| Fast | one<br>two |',
      '',
      'And then some prose.'
    ].join('\n')
    expect(excerpt(body)).toBe('Feature Notes Fast one two And then some prose.')
  })

  it('drops a thematic break rather than leaving its dashes', () => {
    expect(excerpt('One.\n\n---\n\nTwo.')).toBe('One. Two.')
  })

  it('drops a setext underline', () => {
    expect(excerpt('A title\n=======\n\nBody.')).toBe('A title Body.')
  })

  it('strips every <br> spelling', () => {
    expect(excerpt('a<br>b<br/>c<BR />d')).toBe('a b c d')
  })

  it('keeps ordinary hyphens, pipes-in-prose aside', () => {
    expect(excerpt('A well-known state-of-the-art result.')).toBe(
      'A well-known state-of-the-art result.'
    )
  })

  it('leaves the existing strips working', () => {
    expect(
      excerpt('# Title\n\n{% hero title="x" /%}\n\n![alt](/a.png) [text](/b) *em*')
    ).toBe('Title text em')
  })

  it('still truncates on a word boundary', () => {
    const out = excerpt('| a | b |\n| --- | --- |\n' + 'word '.repeat(60), 40)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(41)
    expect(out).not.toContain('|')
  })
})
