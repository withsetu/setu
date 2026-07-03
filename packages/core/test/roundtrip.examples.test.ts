import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const SAMPLES: Record<string, string> = {
  basic: `# Summer Launch

Our **biggest** release *yet*, with \`code\` and a [link](https://setu.dev).

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
  checklist: `- [ ] todo
- [x] done with **bold**
`,
  nested: `- a
  - b
    - c
`,
  nestedChecklist: `- [ ] parent
  - [x] child
  - [ ] other
`,
  mixedNesting: `- parent
  - [ ] sub task
  - plain sub
`,
  table: `| Name | Role |
| --- | --- |
| Ada | Eng |
| Mai | PM |
`,
  tableAligned: `| L | C | R |
| :-- | :-: | --: |
| a | b | c |
`,
  tableMarks: `| h | link |
| --- | --- |
| **b** | [site](https://setu.dev) |
`,
  alignParagraph: `Centered{% align="center" %}
`,
  alignHeading: `## Title{% align="right" %}
`,
  alignWithMarks: `a **b**{% align="center" %}
`
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
    ['link', 'A [link](https://setu.dev).\n'],
    ['blockquote', '> quoted\n'],
    ['checklist', '- [ ] todo\n- [x] done\n'],
    ['checklist with marks', '- [ ] do the **thing**\n'],
    ['nested bullet', '- a\n  - b\n'],
    ['nested checklist', '- [ ] p\n  - [x] c\n'],
    ['mixed bullet>checklist', '- parent\n  - [ ] sub\n'],
    ['mixed checklist>bullet', '- [ ] parent\n  - plain\n'],
    ['empty checklist row', '- [ ]\n'],
    ['checklist with an empty row', '- [x] done\n- [ ]\n'],
    ['table', '| Name | Role |\n| --- | --- |\n| Ada | Eng |\n'],
    ['table aligned', '| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |\n'],
    [
      'table with marks',
      '| h | l |\n| --- | --- |\n| **b** | [x](https://y.dev) |\n'
    ],
    ['aligned paragraph', 'Centered{% align="center" %}\n'],
    ['aligned heading', '## Title{% align="right" %}\n'],
    ['align with marks', 'a **b**{% align="center" %}\n']
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

  it('a plain bullet list round-trips unchanged (no checkbox injected)', () => {
    expect(roundtrip('- a\n- b\n')).toBe('- a\n- b\n')
  })

  it('a partial-marker list keeps its literal [ ] text (not silently converted)', () => {
    expect(roundtrip('- [ ] a\n- b\n')).toBe('- [ ] a\n- b\n')
  })

  it('uppercase [X] normalises to lowercase [x] and stays checked', () => {
    expect(roundtrip('- [X] done\n')).toBe('- [x] done\n')
  })
})

describe('table content-safety', () => {
  it('a pipe in cell text round-trips without breaking the grid', () => {
    const src = '| a | b |\n| --- | --- |\n| x \\| y | z |\n'
    expect(roundtrip(src)).toBe(src)
  })

  it('a pipe inside a code span in a cell survives', () => {
    const src = '| a |\n| --- |\n| `p\\|q` |\n'
    expect(roundtrip(src)).toBe(src)
  })
})

describe('text-align content-safety', () => {
  it('a plain paragraph never gains an align annotation', () => {
    expect(roundtrip('Plain paragraph.\n')).toBe('Plain paragraph.\n')
  })

  it('align="left" normalises away (default, no annotation)', () => {
    expect(roundtrip('L{% align="left" %}\n')).toBe('L\n')
  })
})
