// Named validation for block tag attributes (#1126).
//
// The generated include (markdoc.blocks.generated.mjs, from @setu/core's
// generateMarkdocTagsInclude) wraps every block attribute in `blockAttr` and every block tag
// in `blockTagValidate`. Markdoc's built-in `type`/`matches` checks are deliberately NOT used
// for block attributes: their messages name the attribute but never the block, so a page
// with four blocks fails the build with "Attribute 'collection' must match one of …" and the
// author has to hunt. Every message here names the block, the attribute, what was expected
// and what was found. Covered by apps/site/test/markdoc-attr-validate.test.ts, which runs
// real Markdoc validation over configs built from these helpers.
//
// Plain JS, no imports: @astrojs/markdoc esbuild-bundles markdoc.config.mjs with every bare
// package external and then imports it in Node, where @setu/core's TS source cannot load.

/** Markdoc's own global attributes, accepted on every tag. */
const GLOBAL_ATTRS = new Set(['class', 'id'])

const TYPE_NOUN = {
  String: 'a string',
  Number: 'a number',
  Boolean: 'true or false',
  Array: 'a list'
}

const isAstValue = (v) =>
  v !== null && typeof v === 'object' && typeof v.$$mdtype === 'string'

function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'object') return 'an object'
  return String(value)
}

function hasType(type, value) {
  switch (type) {
    case 'String':
      return typeof value === 'string'
    case 'Number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'Boolean':
      return typeof value === 'boolean'
    case 'Array':
      return Array.isArray(value)
    default:
      return true
  }
}

const quoteList = (xs) => xs.map((x) => JSON.stringify(x)).join(', ')

/** The error messages for one attribute value, or `[]` when it is valid. Exported for the
 *  unit test; Markdoc reaches it through `blockAttr(...).validate`. */
export function blockAttrErrors(tag, name, spec, value) {
  // A `$variable` / function call is resolved at render time — nothing to check statically.
  if (isAstValue(value)) return []
  const where = `{% ${tag} %} attribute "${name}"`
  if (!hasType(spec.type, value)) {
    return [
      `${where} must be ${TYPE_NOUN[spec.type] ?? spec.type} — got ${describe(value)}.`
    ]
  }
  if (Array.isArray(spec.matches) && !spec.matches.includes(value)) {
    if (spec.ref === 'collection') {
      return [
        `${where} must name a collection declared in setu.config — one of ` +
          `${quoteList(spec.matches)} — got ${describe(value)}. ` +
          'Declare it under `collections` in setu.config.ts, or pick an existing one.'
      ]
    }
    return [
      `${where} must be one of ${quoteList(spec.matches)} — got ${describe(value)}.`
    ]
  }
  return []
}

/** A Markdoc attribute schema whose validation produces named errors. Keeps `default`
 *  (Markdoc's transform applies it); carries no `type`/`matches`, so Markdoc's own unnamed
 *  messages never fire alongside these. */
export function blockAttr(tag, name, spec) {
  return {
    ...(spec.default !== undefined ? { default: spec.default } : {}),
    validate: (value) =>
      blockAttrErrors(tag, name, spec, value).map((message) => ({
        id: 'attribute-value-invalid',
        level: /** @type {const} */ ('error'),
        message
      }))
  }
}

/** Tag-level check naming the block on an unknown attribute. Markdoc still reports its own
 *  "Invalid attribute: 'x'" for the same mistake (that check cannot be switched off per tag);
 *  this line adds which block it was and what the block does accept. */
export function blockTagValidate(tag) {
  return (node, config) => {
    const known = Object.keys(config?.tags?.[tag]?.attributes ?? {})
    const errors = []
    for (const key of Object.keys(node.attributes ?? {})) {
      if (known.includes(key) || GLOBAL_ATTRS.has(key)) continue
      errors.push({
        id: 'attribute-undefined',
        level: /** @type {const} */ ('error'),
        message:
          `{% ${tag} %} has no attribute "${key}". ` +
          (known.length
            ? `It accepts: ${known.join(', ')}.`
            : 'It takes no attributes.')
      })
    }
    return errors
  }
}
