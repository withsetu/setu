// #816: this script regenerates COMMITTED product source (packages/core/src/health/rubric.ts)
// from a third-party network response. Its header promises that on ANY parse/validation failure
// rubric.ts is left untouched — but the most likely failure, an upstream reformat, produced an
// EMPTY parse that validated clean and overwrote the rubric with three items. These tests pin the
// refusals. All fixtures are strings; nothing here touches the network or the filesystem.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendExtras,
  assertNoShrink,
  countRubricItems,
  MIN_ITEMS,
  parseChecklist,
  SECTION_TO_CATEGORY,
  validate
} from './sync-health-rubric.mjs'

const SECTIONS = Object.keys(SECTION_TO_CATEGORY)

/** A well-formed checklist: every mapped section, three items each, in the exact upstream shape
 *  ITEM_RE is pinned to. */
function checklist({
  omit = [],
  rename = {},
  mangle = false,
  perSection = 3
} = {}) {
  const out = ['# The Website Specification — checklist', '']
  for (const section of SECTIONS) {
    if (omit.includes(section)) continue
    const slugBase = SECTION_TO_CATEGORY[section]
    out.push(`## ${rename[section] ?? section}`, '')
    for (let i = 0; i < perSection; i++) {
      const slug = `${slugBase}-item-${i}`
      const dash = mangle ? '-' : '—'
      out.push(
        `- [ ] **Item ${slug}** _(required)_ ${dash} Guidance for ${slug}.`,
        `      https://specification.website/spec/${slugBase}/${slug}`,
        ''
      )
    }
  }
  return out.join('\n')
}

test('a well-formed checklist parses and validates', () => {
  const items = parseChecklist(checklist())
  assert.equal(items.length, SECTIONS.length * 3)
  assert.ok(items.length >= MIN_ITEMS)
  validate(items) // must not throw
  // The leading `# …` title chunk is a preamble, not an unknown section — it must not throw.
  assert.ok(
    items.every((i) => i.url.startsWith('https://specification.website'))
  )
})

test('an upstream reformat throws instead of returning an empty parse', () => {
  // The exact #816 scenario: the em-dash separator changes, ITEM_RE matches nothing, and the old
  // code returned [] → validate([]) passed → rubric.ts was overwritten with 3 items.
  assert.throws(
    () => parseChecklist(checklist({ mangle: true })),
    /0 items|no items|produced no/i
  )
})

test('a renamed section throws instead of silently skipping a whole category', () => {
  assert.throws(
    () =>
      parseChecklist(
        checklist({ rename: { Internationalisation: 'Internationalization' } })
      ),
    /Internationalization/
  )
})

test('a section that disappears upstream throws', () => {
  assert.throws(
    () => parseChecklist(checklist({ omit: ['Security'] })),
    /Security/
  )
})

test('validate refuses a collapsed item count below the floor', () => {
  const items = parseChecklist(checklist())
  assert.throws(() => validate(items.slice(0, MIN_ITEMS - 1)), /floor|too few/i)
  assert.throws(() => validate([]), /floor|too few/i)
  validate(items.slice(0, MIN_ITEMS)) // exactly the floor is allowed
})

test('appendExtras returns the extras it ACTUALLY appended, not a tail slice', () => {
  const spec = parseChecklist(checklist())
  const extras = [
    {
      id: 'x.one',
      category: 'seo',
      severity: 'required',
      title: 'One',
      guidance: 'g',
      url: 'u'
    },
    {
      id: 'x.two',
      category: 'seo',
      severity: 'required',
      title: 'Two',
      guidance: 'g',
      url: 'u'
    }
  ]
  const clean = appendExtras(spec, extras)
  assert.equal(clean.specItems.length, spec.length)
  assert.deepEqual(
    clean.extraItems.map((e) => e.id),
    ['x.one', 'x.two']
  )
  assert.deepEqual(clean.collisions, [])
  assert.equal(clean.items.length, spec.length + 2)

  // THE BUG: when an extra collides with a spec id it is NOT appended, so the old unconditional
  // `items.slice(items.length - EXTRA_ITEMS.length)` stole a genuine spec item and emitted it
  // under "Setu-specific (not in the spec checklist)".
  const collide = [{ ...extras[0], id: spec[0].id }, extras[1]]
  const res = appendExtras(spec, collide)
  assert.deepEqual(res.collisions, [spec[0].id])
  assert.deepEqual(
    res.extraItems.map((e) => e.id),
    ['x.two'],
    'only the genuinely appended extra is reported as Setu-specific'
  )
  assert.equal(res.extraItems.length, 1, 'the logged count is the real count')
  assert.deepEqual(
    res.specItems.map((i) => i.id),
    spec.map((i) => i.id),
    'no spec item was reclassified as Setu-specific'
  )
})

test('countRubricItems counts items in the committed rubric format', () => {
  const src = [
    'export const RUBRIC: RubricItem[] = [',
    '  // Foundations',
    "  { id: 'foundations.doctype', category: 'foundations' },",
    '  {',
    "    id: 'foundations.lang',",
    "    category: 'foundations'",
    '  },',
    ']'
  ].join('\n')
  assert.equal(countRubricItems(src), 2)
  assert.equal(countRubricItems(''), 0)
})

test('assertNoShrink refuses a >20% shrink unless --allow-shrink is passed', () => {
  assert.throws(() => assertNoShrink(100, 143, false), /shrink|--allow-shrink/i)
  assert.throws(() => assertNoShrink(3, 143, false), /shrink|--allow-shrink/i)
  assertNoShrink(100, 143, true) // explicit opt-in
  assertNoShrink(120, 143, false) // ~16% — within tolerance
  assertNoShrink(167, 143, false) // growth
  assertNoShrink(50, 0, false) // no existing file to compare against
})
