import Markdoc from '@markdoc/markdoc'

const N = Markdoc.Ast.Node

/** Simulated setu.config.ts: Markdoc tags with a first-class editor UI. */
const KNOWN_BLOCK_TAGS = new Set(['callout'])

const hasError = (node) =>
  node.type === 'error' || (Array.isArray(node.errors) && node.errors.length > 0)

const isNativeTag = (node) => node.type === 'tag' && KNOWN_BLOCK_TAGS.has(node.tag)

// A top-level node we don't natively edit -> must be preserved verbatim.
const isPreserve = (node) =>
  hasError(node) || (node.type === 'tag' && !KNOWN_BLOCK_TAGS.has(node.tag))

// ---------------------------------------------------------------------------
// Markdoc  ->  Tiptap   (preserve unknown/advanced/broken content by SOURCE SLICE)
// ---------------------------------------------------------------------------

function inlineToTiptap(node, marks = []) {
  switch (node.type) {
    case 'inline':
      return node.children.flatMap((c) => inlineToTiptap(c, marks))
    case 'text':
      return [{ type: 'text', text: node.attributes.content, ...(marks.length ? { marks } : {}) }]
    case 'strong':
      return node.children.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'bold' }]))
    case 'em':
      return node.children.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'italic' }]))
    case 's':
      return node.children.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'strike' }]))
    case 'code':
      return [{ type: 'text', text: node.attributes.content, marks: [...marks, { type: 'code' }] }]
    case 'link':
      return node.children.flatMap((c) =>
        inlineToTiptap(c, [...marks, { type: 'link', attrs: { href: node.attributes.href } }]),
      )
    case 'hardbreak':
      return [{ type: 'hardBreak' }]
    case 'softbreak':
      return [{ type: 'text', text: ' ' }]
    default:
      return []
  }
}

const collectInline = (node) => (node.children ?? []).flatMap((c) => inlineToTiptap(c))

function blockToTiptap(node) {
  switch (node.type) {
    case 'heading':
      return { type: 'heading', attrs: { level: node.attributes.level }, content: collectInline(node) }
    case 'paragraph':
      return { type: 'paragraph', content: collectInline(node) }
    case 'list':
      return {
        type: node.attributes.ordered ? 'orderedList' : 'bulletList',
        content: node.children.map((item) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: collectInline(item) }],
        })),
      }
    case 'blockquote':
      return { type: 'blockquote', content: node.children.map(blockToTiptap).filter(Boolean) }
    case 'fence':
      return {
        type: 'codeBlock',
        attrs: { language: node.attributes.language || null },
        content: [{ type: 'text', text: String(node.attributes.content).replace(/\n$/, '') }],
      }
    case 'hr':
      return { type: 'horizontalRule' }
    case 'tag':
      return {
        type: 'callout',
        attrs: { mdAttrs: node.attributes },
        content: node.children.map(blockToTiptap).filter(Boolean),
      }
    default:
      return null
  }
}

export function markdocToTiptap(source) {
  const lines = source.split('\n')
  const ast = Markdoc.parse(source, { location: true })
  const kids = ast.children
  const out = []

  const startOf = (i) => kids[i]?.location?.start?.line ?? lines.length
  const slice = (from, to) => lines.slice(from, to).join('\n').replace(/\n+$/, '')

  for (let i = 0; i < kids.length; ) {
    const node = kids[i]

    if (isPreserve(node)) {
      const startLine = startOf(i)
      let j = i
      if (hasError(node)) {
        // a broken construct fragments across siblings — absorb through the
        // matching closing error (or to the end of the error run)
        while (j + 1 < kids.length) {
          j++
          if (hasError(kids[j])) break
        }
      }
      const endLine = startOf(j + 1)
      out.push({
        type: 'passthrough',
        attrs: { raw: slice(startLine, endLine), flagged: hasError(node) },
      })
      i = j + 1
      continue
    }

    const tt = blockToTiptap(node)
    if (tt) out.push(tt)
    i++
  }
  return { type: 'doc', content: out }
}

// ---------------------------------------------------------------------------
// Tiptap  ->  Markdoc
//   native blocks: build AST + format (canonical, idempotent)
//   passthrough:   emit preserved source verbatim
// ---------------------------------------------------------------------------

function buildInline(content = []) {
  return content.map((t) => {
    if (t.type === 'hardBreak') return new N('hardbreak')
    let n = new N('text', { content: t.text })
    for (const m of t.marks ?? []) {
      if (m.type === 'code') n = new N('code', { content: t.text })
      else if (m.type === 'bold') n = new N('strong', { marker: '**' }, [n])
      else if (m.type === 'italic') n = new N('em', { marker: '*' }, [n])
      else if (m.type === 'strike') n = new N('s', {}, [n])
      else if (m.type === 'link') n = new N('link', { href: m.attrs.href }, [n])
    }
    return n
  })
}

function buildBlock(node) {
  switch (node.type) {
    case 'heading':
      return new N('heading', { level: node.attrs.level }, [new N('inline', {}, buildInline(node.content))])
    case 'paragraph':
      return new N('paragraph', {}, [new N('inline', {}, buildInline(node.content))])
    case 'bulletList':
    case 'orderedList':
      return new N(
        'list',
        { ordered: node.type === 'orderedList', marker: node.type === 'orderedList' ? '1.' : '-' },
        node.content.map((item) =>
          new N('item', {}, [new N('inline', {}, buildInline(item.content?.[0]?.content ?? []))]),
        ),
      )
    case 'blockquote':
      return new N('blockquote', {}, node.content.map(buildBlock))
    case 'codeBlock':
      return new N('fence', {
        content: (node.content?.[0]?.text ?? '') + '\n',
        language: node.attrs?.language || '',
      })
    case 'horizontalRule':
      return new N('hr')
    case 'callout':
      return new N('tag', node.attrs?.mdAttrs ?? {}, node.content.map(buildBlock), 'callout')
    default:
      return new N('paragraph', {}, [])
  }
}

const formatNative = (node) =>
  Markdoc.format(new N('document', {}, [buildBlock(node)])).replace(/\n+$/, '')

export function tiptapToMarkdoc(doc) {
  const blocks = doc.content.map((node) =>
    node.type === 'passthrough' ? node.attrs.raw : formatNative(node),
  )
  return blocks.join('\n\n') + '\n'
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const SAMPLES = {
  'basic markdown': `# Summer Launch

Our **biggest** release *yet*, with \`code\` and a [link](https://setu.dev).

- one
- two
- three

> A blockquote.
`,
  'known block (callout)': `# Notes

{% callout type="warning" %}
Pre-orders open Friday — limited stock.
{% /callout %}
`,
  'advanced: if (passthrough)': `# Promo

{% if $flags.blackFriday %}
50% off everything!
{% /if %}

Normal paragraph after.
`,
  'malformed/unknown (preserve+flag)': `Intro.

{% for $product in $products %}
- {% $product.name %}
{% /for %}

Outro.
`,
  'self-closing partial (passthrough)': `Intro.

{% partial file="promo.md" /%}

Outro.
`,
  'mixed everything': `# Mixed

Some **bold** text.

{% callout type="info" %}
A callout with *emphasis*.
{% /callout %}

{% if $user.isPro %}
Pro-only content here.
{% /if %}

- list item one
- list item two
`,
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const controls = (s) => s.match(/\{%[^%]*%\}/g) ?? []

let idempotent = 0, ppOkCount = 0, total = 0, ppTotal = 0, byteIdentical = 0

console.log('═'.repeat(72))
console.log('  SETU SPIKE #1 — Markdoc ⇄ Tiptap round-trip (source-slice preserve)')
console.log('═'.repeat(72))

for (const [name, S0] of Object.entries(SAMPLES)) {
  total++
  const advanced = /(passthrough|preserve)/.test(name)
  if (advanced) ppTotal++

  const J0 = markdocToTiptap(S0)
  const S1 = tiptapToMarkdoc(J0)
  const J1 = markdocToTiptap(S1)
  const S2 = tiptapToMarkdoc(J1)

  const stable = S1 === S2
  const parseStable = eq(J0, J1)
  const byteId = S0 === S1
  const ppOk = advanced ? controls(S0).every((c) => S1.includes(c)) : true

  if (stable) idempotent++
  if (byteId) byteIdentical++
  if (advanced && ppOk) ppOkCount++

  console.log(`\n● ${name}`)
  console.log(`  idempotent (S1===S2).............. ${stable ? '✓ PASS' : '✗ FAIL'}`)
  console.log(`  byte-identical first save (S0===S1) ${byteId ? '✓ yes' : '— normalized'}`)
  console.log(`  parse-stable (J0===J1)............ ${parseStable ? '✓' : '✗'}`)
  if (advanced) console.log(`  advanced syntax preserved verbatim ${ppOk ? '✓ PASS' : '✗ FAIL'}`)
  if (!stable) { console.log('  --- S1 vs S2 ---'); console.log(S1, '\n  ≠\n', S2) }
}

console.log('\n' + '═'.repeat(72))
console.log(`  idempotent ${idempotent}/${total}  |  byte-identical ${byteIdentical}/${total}  |  advanced preserved ${ppOkCount}/${ppTotal}`)
console.log('═'.repeat(72))

console.log('\n── "malformed/unknown" round-trips byte-for-byte (never dropped, flagged) ──\n')
const Jm = markdocToTiptap(SAMPLES['malformed/unknown (preserve+flag)'])
console.log('Tiptap nodes:', Jm.content.map((n) => n.type + (n.attrs?.flagged ? '⚠' : '')).join(', '))
console.log('\nRe-serialized:\n' + tiptapToMarkdoc(Jm))

process.exit(idempotent === total && ppOkCount === ppTotal ? 0 : 1)
