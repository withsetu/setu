/**
 * sync-health-rubric.mjs — maintainer script
 *
 * Fetches the full checklist from the specification.website MCP and regenerates
 * packages/core/src/health/rubric.ts with the complete set of RubricItems.
 *
 * Usage:
 *   node scripts/sync-health-rubric.mjs
 *   node scripts/sync-health-rubric.mjs --allow-shrink   # accept a >20% smaller rubric
 *
 * Requirements: Node 18+ (native fetch). No extra dependencies.
 * Must be run from the repo root (or any directory — paths are resolved from this file).
 *
 * Safety: on ANY error (network, parse, validation) the script prints the error and exits
 * non-zero WITHOUT writing to rubric.ts. The current rubric is never overwritten with garbage.
 * That promise used to have a hole (#816): the likeliest failure — an upstream reformat — made
 * ITEM_RE match nothing, and an EMPTY parse validated clean and overwrote the rubric with just
 * the three EXTRA_ITEMS. The refusals that close it, each covered by sync-health-rubric.test.mjs:
 *   - an unmapped `## ` section throws (a renamed section used to vanish behind a console.warn)
 *   - a mapped section that yields zero items throws, as does one missing from the markdown
 *   - fewer than MIN_ITEMS items throws
 *   - a >20% shrink against the committed rubric.ts throws unless --allow-shrink is passed
 *
 * After a successful run, verify with:
 *   pnpm --filter @setu/core test -- health-rubric
 *   pnpm --filter @setu/core test -- health-audit
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { isDirectInvocation } from './auth-login-link.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUBRIC_PATH = resolve(__dirname, '../packages/core/src/health/rubric.ts')
const MCP_URL = 'https://mcp.specification.website/mcp'
const SPEC_BASE = 'https://specification.website'

// ---------------------------------------------------------------------------
// MCP transport helpers
// ---------------------------------------------------------------------------

let _sessionId = null

async function mcpRequest(method, params = {}, id = 1) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  }
  if (_sessionId) headers['mcp-session-id'] = _sessionId

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  })

  if (!res.ok) {
    throw new Error(`MCP ${method} → HTTP ${res.status} ${res.statusText}`)
  }

  // Grab session id if provided
  const sid = res.headers.get('mcp-session-id')
  if (sid) _sessionId = sid

  const text = await res.text()

  // Streamable HTTP may return SSE — multiple `data:` events can appear.
  // Parse each one and pick the object that carries a `result` (the final response).
  // Intermediate events (e.g. progress notifications) only carry `method`, not `result`.
  let json
  if (text.includes('data:')) {
    const dataLines = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)

    let found = null
    for (const line of dataLines) {
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      if (parsed && 'result' in parsed) {
        found = parsed
        break
      }
    }
    if (!found) {
      // fallback: try the last data line (original behaviour)
      found = JSON.parse(dataLines[dataLines.length - 1])
    }
    json = found
  } else {
    json = JSON.parse(text)
  }

  if (json.error) {
    throw new Error(`MCP error (${json.error.code}): ${json.error.message}`)
  }

  return json.result
}

async function mcpInit() {
  await mcpRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'setu-sync-health-rubric', version: '1.0.0' }
  })
}

async function getChecklist() {
  const result = await mcpRequest(
    'tools/call',
    { name: 'get_checklist', arguments: {} },
    2
  )
  const content = result?.content
  if (!Array.isArray(content) || !content[0]?.text) {
    throw new Error('get_checklist returned unexpected structure')
  }
  return content[0].text
}

// ---------------------------------------------------------------------------
// Markdown → RubricItem[] parser
// ---------------------------------------------------------------------------

export const SECTION_TO_CATEGORY = {
  Foundations: 'foundations',
  SEO: 'seo',
  Accessibility: 'accessibility',
  Security: 'security',
  'Well-Known URIs': 'well-known',
  'Agent Readiness': 'agent-readiness',
  Performance: 'performance',
  Privacy: 'privacy',
  Resilience: 'resilience',
  Internationalisation: 'i18n'
}

const SEV_MAP = {
  required: 'required',
  recommended: 'recommended',
  optional: 'optional',
  avoid: 'avoid'
}

// Items that have a live probe in the engine — response-header checks only.
// MUST equal PROBE_ITEM_IDS in packages/core/src/health/probe.ts: a `liveProbe` item with
// no evaluator resolves to `pending` forever, which scoring drops from the denominator
// while `mustHaves.total` still counts it (#659). A test pins the two sets together.
// Core Web Vitals is deliberately NOT here: LCP/INP/CLS need field data (CrUX) or a lab
// run, not one response's headers, so it is an attestable manual item.
// These ids use the STABLE ids (see ID_OVERRIDES below), not the spec slug.
const LIVE_PROBE_IDS = new Set([
  'security.https',
  'security.hsts',
  'security.csp',
  'security.content-type-options'
])

/**
 * Stable id overrides: spec slug → the id that existing EVALUATORS/APPLIES_WHEN reference.
 * Any spec slug NOT listed here gets id = `${category}.${slug}`.
 * IMPORTANT: these must never be changed once evaluators exist that key off them.
 *
 * Format: 'category.spec-slug': 'stable-id'
 * The stable-id's prefix (before the dot) determines the category used in the output.
 */
const ID_OVERRIDES = {
  // foundations
  'foundations.html-lang': 'foundations.lang',
  'foundations.meta-charset': 'foundations.charset',
  'foundations.meta-viewport': 'foundations.viewport',
  'foundations.meta-description': 'foundations.description',
  'foundations.canonical-url': 'foundations.canonical',
  'foundations.favicons': 'foundations.favicon',
  'foundations.open-graph': 'foundations.open-graph',
  'foundations.feed-discovery': 'foundations.feed',
  // seo
  'seo.xml-sitemaps': 'seo.sitemap',
  'seo.url-structure': 'seo.canonical-route',
  'seo.heading-hierarchy': 'seo.single-h1',
  'seo.structured-data': 'seo.json-ld',
  'seo.meta-robots': 'seo.indexable',
  // accessibility
  'accessibility.image-alt-text': 'accessibility.image-alt',
  'accessibility.focus-indicators': 'accessibility.focus-styles',
  'accessibility.skip-links': 'accessibility.skip-link',
  // agent-readiness
  'agent-readiness.llms-txt': 'agent-readiness.llms-txt',
  'agent-readiness.markdown-source-endpoints': 'agent-readiness.markdown',
  // security — map spec slugs to short stable ids that EVALUATORS key off
  'security.https-tls': 'security.https',
  'security.content-security-policy': 'security.csp',
  'security.x-content-type-options': 'security.content-type-options',
  'security.security-txt': 'well-known.security-txt',
  // well-known — security.txt moved to security section in spec but we keep legacy id
  // performance
  'performance.core-web-vitals': 'performance.core-web-vitals',
  // privacy
  'privacy.privacy-policy': 'privacy.policy',
  // resilience
  'resilience.error-pages': 'resilience.custom-404',
  // i18n
  'i18n.hreflang': 'i18n.hreflang'
}

const GUIDANCE_CAP = 300

/**
 * Return a guidance string from the spec description.
 * Rules:
 *  1. If the spec desc fits within GUIDANCE_CAP chars, use it in full.
 *  2. Otherwise try to cut at a sentence boundary (last `. ` within the cap).
 *  3. If no sentence boundary is found within the cap, cut at the last word boundary.
 *  4. Never append `…` after a dangling mid-word cut.
 *
 * The spec is CC BY 4.0 so reproducing fuller text is fine.
 */
function paraphrase(title, specDesc, _cat, _slug) {
  const s = specDesc.trim()
  if (s.length <= GUIDANCE_CAP) return s

  // Try sentence boundary: last `. ` within the cap
  const sub = s.slice(0, GUIDANCE_CAP)
  const lastSentenceEnd = sub.lastIndexOf('. ')
  if (lastSentenceEnd > 0) {
    return s.slice(0, lastSentenceEnd + 1)
  }

  // No sentence boundary — cut at last word boundary, no ellipsis
  const lastSpace = sub.lastIndexOf(' ')
  return lastSpace > 0 ? s.slice(0, lastSpace) : sub
}

// ---------------------------------------------------------------------------
// Setu-specific rubric items (not in the specification.website checklist)
// These are CMS-layer checks that the EVALUATORS in checks.ts reference.
// They are APPENDED to the synced spec items on every re-run so they survive
// future sync-health-rubric calls without manual editing of rubric.ts.
// ---------------------------------------------------------------------------

const EXTRA_ITEMS = [
  {
    id: 'seo.homepage',
    category: 'seo',
    severity: 'required',
    title: 'Homepage resolves',
    guidance:
      "The homepage you've configured resolves to an existing content entry.",
    url: 'https://specification.website/spec/seo/url-structure'
  },
  {
    id: 'foundations.entry-title',
    category: 'foundations',
    severity: 'required',
    title: 'Entry titles',
    guidance: 'Every content entry has a non-empty title.',
    url: 'https://specification.website/spec/foundations/title'
  },
  {
    id: 'foundations.twitter-card',
    category: 'foundations',
    severity: 'optional',
    title: 'Twitter/X Card tags',
    guidance:
      'twitter: card tags refine link previews on X/Twitter (Open Graph covers most cases).',
    url: 'https://specification.website/spec/foundations/open-graph'
  }
]

// Item regex: captures title, severity, description, url
const ITEM_RE =
  /^- \[ \] \*\*(.+?)\*\* _\((\w+)\)_ — (.+?)\n\s+(https:\/\/specification\.website\/spec\/[^\s]+)/gm

export function parseChecklist(markdown) {
  const chunks = markdown.split(/^## /m)
  const items = []
  const seen = new Set()
  // Items parsed per mapped section name — the evidence for the coverage refusals below.
  const perSection = new Map()
  // Everything before the first `## ` is the document title/preamble, not a section. Only that
  // one chunk is exempt; any OTHER unmapped heading is a rename or a new section and throws.
  const hasLeadingPreamble = !/^## /.test(markdown)

  for (const [i, section] of chunks.entries()) {
    if (i === 0 && hasLeadingPreamble) continue
    if (!section.trim()) continue
    const nameEnd = section.indexOf('\n')
    const secName = section.slice(0, nameEnd).trim()
    const category = SECTION_TO_CATEGORY[secName]
    if (!category) {
      throw new Error(
        `Unknown checklist section "${secName}" — the upstream spec renamed or added a section. ` +
          'Update SECTION_TO_CATEGORY (and ID_OVERRIDES if ids move) rather than letting a whole ' +
          'category silently disappear from rubric.ts.'
      )
    }
    perSection.set(secName, perSection.get(secName) ?? 0)
    const body = section.slice(nameEnd)
    let m
    ITEM_RE.lastIndex = 0
    while ((m = ITEM_RE.exec(body)) !== null) {
      const [, title, rawSev, specDesc, url] = m
      const severity = SEV_MAP[rawSev.toLowerCase()]
      if (!severity) {
        console.warn(
          `  [warn] Unknown severity "${rawSev}" for "${title}" — skipped`
        )
        continue
      }
      const urlSlug = url.replace(/\/$/, '').split('/').pop()
      const specId = `${category}.${urlSlug}`
      const id = ID_OVERRIDES[specId] ?? specId

      if (seen.has(id)) {
        console.warn(`  [warn] Duplicate id "${id}" (from "${url}") — skipped`)
        continue
      }
      seen.add(id)

      // If the override changes the category prefix (e.g. security.security-txt → well-known.security-txt),
      // derive the effective category from the stable id prefix.
      const effectiveCategory = id.includes('.') ? id.split('.')[0] : category

      const guidance = paraphrase(title, specDesc, effectiveCategory, urlSlug)
      const item = {
        id,
        category: effectiveCategory,
        severity,
        title,
        guidance,
        url: url.replace(/\/$/, '')
      }
      if (LIVE_PROBE_IDS.has(id)) {
        item.liveProbe = true
      }
      items.push(item)
      perSection.set(secName, perSection.get(secName) + 1)
    }
  }

  // Coverage: every section we know how to map must be present AND must have yielded items. A
  // reformat that leaves the headings intact but breaks ITEM_RE shows up here as a zero, which is
  // the failure the old code turned into a silent empty rubric (#816).
  for (const secName of Object.keys(SECTION_TO_CATEGORY)) {
    const n = perSection.get(secName)
    if (n === undefined)
      throw new Error(
        `Checklist section "${secName}" is missing from the upstream markdown — refusing to ` +
          'write a rubric with that whole category dropped. If the section was genuinely retired ' +
          'upstream, remove it from SECTION_TO_CATEGORY deliberately.'
      )
    if (n === 0)
      throw new Error(
        `Checklist section "${secName}" produced 0 items — the item format upstream no longer ` +
          'matches ITEM_RE. Refusing to overwrite rubric.ts.'
      )
  }

  return items
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set([
  'required',
  'recommended',
  'optional',
  'avoid'
])
const VALID_CATEGORIES = new Set([
  'foundations',
  'seo',
  'accessibility',
  'security',
  'well-known',
  'agent-readiness',
  'performance',
  'privacy',
  'resilience',
  'i18n'
])

/** Hard floor on the parsed item count. The committed rubric has ~143 items; anything near zero
 *  means the parse collapsed, not that the spec shrank. Enforced by the "validate refuses a
 *  collapsed item count" test. */
export const MIN_ITEMS = 20

export function validate(items) {
  if (items.length < MIN_ITEMS)
    throw new Error(
      `Only ${items.length} item(s) parsed, below the floor of ${MIN_ITEMS} — the upstream ` +
        'format almost certainly changed. Refusing to overwrite rubric.ts.'
    )
  const ids = items.map((r) => r.id)
  if (new Set(ids).size !== ids.length) {
    const dup = ids.find((id, i) => ids.indexOf(id) !== i)
    throw new Error(`Duplicate id after parsing: ${dup}`)
  }
  for (const r of items) {
    if (!VALID_SEVERITIES.has(r.severity))
      throw new Error(`Invalid severity "${r.severity}" on item "${r.id}"`)
    if (!VALID_CATEGORIES.has(r.category))
      throw new Error(`Invalid category "${r.category}" on item "${r.id}"`)
    if (!r.title || !r.title.trim())
      throw new Error(`Empty title on item "${r.id}"`)
    if (!r.guidance || !r.guidance.trim())
      throw new Error(`Empty guidance on item "${r.id}"`)
    if (!r.url.startsWith(SPEC_BASE))
      throw new Error(
        `URL "${r.url}" does not start with "${SPEC_BASE}" on item "${r.id}"`
      )
  }
  console.log(
    `  ✓ Validation passed: ${items.length} items, all ids unique and valid`
  )
}

// ---------------------------------------------------------------------------
// Code generator
// ---------------------------------------------------------------------------

function serializeItem(item) {
  const fields = [
    `id: ${JSON.stringify(item.id)}`,
    `category: ${JSON.stringify(item.category)}`,
    `severity: ${JSON.stringify(item.severity)}`,
    `title: ${JSON.stringify(item.title)}`,
    `guidance: ${JSON.stringify(item.guidance)}`,
    `url: ${JSON.stringify(item.url)}`
  ]
  if (item.liveProbe) fields.push('liveProbe: true')
  return `  { ${fields.join(', ')} },`
}

function groupByCategory(items) {
  const order = [
    'foundations',
    'seo',
    'accessibility',
    'security',
    'well-known',
    'agent-readiness',
    'performance',
    'privacy',
    'resilience',
    'i18n'
  ]
  const map = new Map(order.map((c) => [c, []]))
  for (const item of items) {
    if (!map.has(item.category)) map.set(item.category, [])
    map.get(item.category).push(item)
  }
  return map
}

function generateRubricTs(specItems, extraItems, syncedAt) {
  const byCategory = groupByCategory(specItems)
  const lines = [
    '// AUTO-GENERATED by scripts/sync-health-rubric.mjs — do not edit by hand.',
    `// Source: https://mcp.specification.website/mcp  Synced: ${syncedAt}`,
    '// To regenerate: node scripts/sync-health-rubric.mjs',
    '// Stable ids (used by EVALUATORS/APPLIES_WHEN in checks.ts) are preserved via ID_OVERRIDES in the script.',
    '',
    "import type { RubricItem } from './types'",
    '',
    'export const RUBRIC: RubricItem[] = ['
  ]

  const PRETTY_SECTION = {
    foundations: 'Foundations',
    seo: 'SEO',
    accessibility: 'Accessibility',
    security: 'Security',
    'well-known': 'Well-Known URIs',
    'agent-readiness': 'Agent Readiness',
    performance: 'Performance',
    privacy: 'Privacy',
    resilience: 'Resilience',
    i18n: 'Internationalisation'
  }

  for (const [cat, catItems] of byCategory) {
    if (!catItems.length) continue
    lines.push(`  // ${PRETTY_SECTION[cat] ?? cat}`)
    for (const item of catItems) {
      lines.push(serializeItem(item))
    }
  }

  // Setu-specific items (not in the spec checklist) — always appended last
  lines.push('  // --- Setu-specific (not in the spec checklist) ---')
  for (const item of extraItems) {
    lines.push(serializeItem(item))
  }

  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Spec / Setu-specific split
// ---------------------------------------------------------------------------

/** Append the Setu-specific items whose ids are NOT already in the spec, and report exactly which
 *  ones were appended. The old code re-derived the split by slicing `EXTRA_ITEMS.length` off the
 *  tail unconditionally — so on the designed collision branch (an EXTRA_ITEMS id that now exists
 *  upstream) fewer items had been appended than the slice assumed, and genuine SPEC items were
 *  emitted under "Setu-specific (not in the spec checklist)" while the log reported a count that
 *  never happened (#816). Enforced by the "appendExtras returns the extras it ACTUALLY appended"
 *  test, whose collision case fails against the slice. */
export function appendExtras(specItems, extras = EXTRA_ITEMS) {
  const specIds = new Set(specItems.map((r) => r.id))
  const extraItems = []
  const collisions = []
  for (const extra of extras) {
    if (specIds.has(extra.id)) collisions.push(extra.id)
    else extraItems.push(extra)
  }
  return {
    specItems,
    extraItems,
    items: [...specItems, ...extraItems],
    collisions
  }
}

/** Count RubricItem entries in rubric.ts source. Matches both this script's own emitted shape
 *  (`{ id: "x", … }`) and the prettier-reformatted committed file (`id: 'x',` on its own line). */
export function countRubricItems(source) {
  return (source.match(/\bid:\s*['"]/g) ?? []).length
}

const SHRINK_TOLERANCE = 0.2

/** Refuse a rubric that is more than 20% smaller than the one on disk. A partial parse failure
 *  passes the floor and the per-section checks (some items in every section) while still dropping
 *  a third of the product's checks; only a size comparison catches that. `--allow-shrink` is the
 *  deliberate opt-in for a genuine upstream reduction. */
export function assertNoShrink(newCount, existingCount, allowShrink) {
  if (allowShrink || !existingCount) return
  if (newCount < existingCount * (1 - SHRINK_TOLERANCE))
    throw new Error(
      `Refusing a ${Math.round((1 - newCount / existingCount) * 100)}% shrink: ${newCount} items ` +
        `vs ${existingCount} in the committed rubric.ts. Re-run with --allow-shrink if the spec ` +
        'genuinely removed that many checks.'
    )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv = []) {
  const allowShrink = argv.includes('--allow-shrink')
  console.log(
    'sync-health-rubric: fetching checklist from specification.website MCP…'
  )

  let checklistMarkdown
  try {
    await mcpInit()
    checklistMarkdown = await getChecklist()
  } catch (err) {
    console.error(
      `\n[ERROR] Network/MCP failure — rubric.ts NOT modified.\n  ${err.message}`
    )
    process.exit(1)
  }

  console.log('  ✓ Checklist received, parsing…')

  let items
  try {
    items = parseChecklist(checklistMarkdown)
  } catch (err) {
    console.error(
      `\n[ERROR] Parse failure — rubric.ts NOT modified.\n  ${err.message}`
    )
    process.exit(1)
  }

  console.log(`  ✓ Parsed ${items.length} items`)

  try {
    validate(items)
  } catch (err) {
    console.error(
      `\n[ERROR] Validation failure — rubric.ts NOT modified.\n  ${err.message}`
    )
    process.exit(1)
  }

  // Append Setu-specific items (they pass validation manually; ids must not collide with spec ids)
  const {
    items: allItems,
    specItems,
    extraItems,
    collisions
  } = appendExtras(items)
  for (const id of collisions)
    console.warn(
      `  [warn] EXTRA_ITEMS id "${id}" now exists in the spec — review and remove from EXTRA_ITEMS.`
    )
  console.log(
    `  ✓ Appended ${extraItems.length} Setu-specific items → total ${allItems.length}`
  )

  let existingCount = 0
  try {
    existingCount = countRubricItems(readFileSync(RUBRIC_PATH, 'utf8'))
  } catch {
    existingCount = 0 // first run / no file to compare against
  }
  try {
    assertNoShrink(allItems.length, existingCount, allowShrink)
  } catch (err) {
    console.error(
      `\n[ERROR] Size check failed — rubric.ts NOT modified.\n  ${err.message}`
    )
    process.exit(1)
  }

  const syncedAt = new Date().toISOString().slice(0, 10)
  const output = generateRubricTs(specItems, extraItems, syncedAt)

  try {
    writeFileSync(RUBRIC_PATH, output, 'utf8')
  } catch (err) {
    console.error(`\n[ERROR] Could not write rubric.ts — ${err.message}`)
    process.exit(1)
  }

  console.log(`  ✓ Written: ${RUBRIC_PATH}`)
  console.log(
    `\nsync-health-rubric: done — ${allItems.length} items written to rubric.ts (${specItems.length} spec + ${extraItems.length} Setu-specific)`
  )
  console.log(
    '\nNext steps:\n  pnpm --filter @setu/core test -- health-rubric\n  pnpm --filter @setu/core test -- health-audit'
  )
}

// Run only as a script: this module writes committed product source, so importing it for a unit
// test must never trigger a fetch-and-overwrite (#816 needed the parser under test).
if (isDirectInvocation(process.argv[1], import.meta.url))
  main(process.argv.slice(2)).catch((err) => {
    console.error(
      `\n[FATAL] Unexpected error — rubric.ts NOT modified.\n  ${err.stack ?? err}`
    )
    process.exit(1)
  })
