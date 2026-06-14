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
