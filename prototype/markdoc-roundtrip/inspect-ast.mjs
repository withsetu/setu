import Markdoc from '@markdoc/markdoc'

// Learn the real AST shapes before writing converters against assumptions.
const SAMPLE = `# Hello

A **bold** and *italic* and \`code\` paragraph with a [link](https://x.com).

- one
- two

> a quote

{% callout type="warning" %}
Watch out
{% /callout %}

{% if $flags.blackFriday %}
50% off everything!
{% /if %}

{% partial file="promo.md" /%}
`

const ast = Markdoc.parse(SAMPLE)

function dump(node, depth = 0) {
  if (!node || typeof node !== 'object') return
  const pad = '  '.repeat(depth)
  const attrs = node.attributes && Object.keys(node.attributes).length
    ? ' ' + JSON.stringify(node.attributes)
    : ''
  const tag = node.tag ? ` tag=${node.tag}` : ''
  console.log(`${pad}${node.type}${tag}${attrs}`)
  for (const child of node.children ?? []) dump(child, depth + 1)
}

console.log('=== AST ===')
dump(ast)

console.log('\n=== Markdoc.format available? ===', typeof Markdoc.format)
console.log('=== Markdoc.Ast.Node available? ===', typeof Markdoc.Ast?.Node)

console.log('\n=== format(whole doc) ===')
console.log(Markdoc.format(ast))

// Can we format a single non-document node (needed for passthrough preservation)?
const ifNode = ast.children.find((c) => c.tag === 'if')
console.log('\n=== format(single if node) ===')
try {
  console.log(JSON.stringify(Markdoc.format(ifNode)))
} catch (e) {
  console.log('FAILED:', e.message)
}
