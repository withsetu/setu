import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const SAMPLES: Record<string, string> = {
  basic: `# Summer Launch

Our **biggest** release *yet*, with \`code\` and a [link](https://saytu.dev).

- one
- two

> A blockquote.
`,
  callout: `# Notes

{% callout type="warning" %}
Pre-orders open Friday.
{% /callout %}
`,
  ifBlock: `# Promo

{% if $flags.blackFriday %}
50% off.
{% /if %}

After.
`,
  subsup: `H{% sub %}2{% /sub %}O and E=mc{% sup %}2{% /sup %}
`,
  malformed: `Intro.

{% for $p in $ps %}
- {% $p.name %}
{% /for %}

Outro.
`,
  partial: `Intro.

{% partial file="promo.md" /%}

Outro.
`,
}

const roundtrip = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

describe('round-trip idempotency', () => {
  for (const [name, s0] of Object.entries(SAMPLES)) {
    it(`is idempotent: ${name}`, () => {
      const s1 = roundtrip(s0)
      const s2 = roundtrip(s1)
      expect(s2).toBe(s1)
    })
  }

  it('preserves advanced/unknown syntax verbatim in the first pass', () => {
    for (const s0 of [SAMPLES.ifBlock!, SAMPLES.malformed!, SAMPLES.partial!]) {
      const s1 = roundtrip(s0)
      const controls = s0.match(/\{%[^%]*%\}/g) ?? []
      for (const c of controls) expect(s1).toContain(c)
    }
  })
})

describe('byte-fidelity round-trip', () => {
  // Each src is canonical Markdoc; round-tripping must produce the exact same bytes.
  // Note: Markdoc.format normalises ordered-list counters to all-1 (markdown HTML spec),
  // so the canonical form is "1. item" for every item, not "1. … 2. … 3. …".
  const cases: [string, string][] = [
    ['ordered list', '1. one\n1. two\n1. three\n'],
    ['code fence', '```js\nconst x = 1\n```\n'],
    ['horizontal rule', '---\n'],
    ['strikethrough', '~~gone~~\n'],
    ['subscript', 'H{% sub %}2{% /sub %}O\n'],
    ['superscript', 'E=mc{% sup %}2{% /sup %}\n'],
    ['link', 'A [link](https://saytu.dev).\n'],
    ['blockquote', '> quoted\n'],
  ]

  for (const [name, src] of cases) {
    it(`is byte-identical: ${name}`, () => {
      expect(roundtrip(src)).toBe(src)
    })
  }
})

describe('checklist content-safety negatives', () => {
  it('a loose bullet list preserves its text (normalised to tight form)', () => {
    expect(roundtrip('- a\n\n- b\n')).toBe('- a\n- b\n')
  })
})
