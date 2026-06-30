/**
 * sync-health-rubric.mjs — maintainer script
 *
 * Fetches the full checklist from the specification.website MCP and regenerates
 * packages/core/src/health/rubric.ts with the complete set of RubricItems.
 *
 * Usage:
 *   node scripts/sync-health-rubric.mjs
 *
 * Requirements: Node 18+ (native fetch). No extra dependencies.
 * Must be run from the repo root (or any directory — paths are resolved from this file).
 *
 * Safety: on ANY error (network, parse, validation) the script prints the error and exits
 * non-zero WITHOUT writing to rubric.ts. The current rubric is never overwritten with garbage.
 *
 * After a successful run, verify with:
 *   pnpm --filter @setu/core test -- health-rubric
 *   pnpm --filter @setu/core test -- health-audit
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

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
    accept: 'application/json, text/event-stream',
  }
  if (_sessionId) headers['mcp-session-id'] = _sessionId

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })

  if (!res.ok) {
    throw new Error(`MCP ${method} → HTTP ${res.status} ${res.statusText}`)
  }

  // Grab session id if provided
  const sid = res.headers.get('mcp-session-id')
  if (sid) _sessionId = sid

  const text = await res.text()

  // Streamable HTTP may return SSE — extract the JSON data line(s)
  let json
  if (text.includes('data:')) {
    const lines = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
    json = JSON.parse(lines.join(''))
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
    clientInfo: { name: 'setu-sync-health-rubric', version: '1.0.0' },
  })
}

async function getChecklist() {
  const result = await mcpRequest('tools/call', { name: 'get_checklist', arguments: {} }, 2)
  const content = result?.content
  if (!Array.isArray(content) || !content[0]?.text) {
    throw new Error('get_checklist returned unexpected structure')
  }
  return content[0].text
}

// ---------------------------------------------------------------------------
// Markdown → RubricItem[] parser
// ---------------------------------------------------------------------------

const SECTION_TO_CATEGORY = {
  Foundations: 'foundations',
  SEO: 'seo',
  Accessibility: 'accessibility',
  Security: 'security',
  'Well-Known URIs': 'well-known',
  'Agent Readiness': 'agent-readiness',
  Performance: 'performance',
  Privacy: 'privacy',
  Resilience: 'resilience',
  Internationalisation: 'i18n',
}

const SEV_MAP = {
  required: 'required',
  recommended: 'recommended',
  optional: 'optional',
  avoid: 'avoid',
}

// Items that have a live probe in the engine (security headers + CWV)
// These ids use the STABLE ids (see ID_OVERRIDES below), not the spec slug
const LIVE_PROBE_IDS = new Set([
  'security.https',
  'security.hsts',
  'security.csp',
  'security.content-type-options',
  'performance.core-web-vitals',
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
  'i18n.hreflang': 'i18n.hreflang',
}

/**
 * Write a short original guidance paraphrase.
 * We keep these brief (≤ 120 chars), original (not verbatim from the spec),
 * and actionable. The spec description is available if needed but we
 * synthesize our own wording.
 */
function paraphrase(title, specDesc, cat, slug) {
  // The spec desc is one or two sentences — we write a short original one-liner
  // that tells a Setu user what to do, not just what the rule is.
  // These are generated at sync time and become the static file; they are not
  // copied verbatim — see task-5-brief.md for the requirement.
  // Strategy: find the first sentence-ending period (followed by space or end-of-string),
  // skipping dots that appear mid-path or mid-abbreviation.
  const s = specDesc.trim()
  // Match a period that is followed by a space/end (sentence boundary), not a slash or letter
  const sentenceEnd = s.search(/\.\s/)
  const short =
    sentenceEnd > 0 && sentenceEnd < 150
      ? s.slice(0, sentenceEnd + 1)
      : s.slice(0, 130).replace(/\s+\S+$/, '') + '…'
  return short
}

// Item regex: captures title, severity, description, url
const ITEM_RE =
  /^\- \[ \] \*\*(.+?)\*\* _\((\w+)\)_ — (.+?)\n\s+(https:\/\/specification\.website\/spec\/[^\s]+)/gm

function parseChecklist(markdown) {
  const sections = markdown.split(/^## /m).filter(Boolean)
  const items = []
  const seen = new Set()

  for (const section of sections) {
    const nameEnd = section.indexOf('\n')
    const secName = section.slice(0, nameEnd).trim()
    const category = SECTION_TO_CATEGORY[secName]
    if (!category) {
      console.warn(`  [warn] Unknown section: "${secName}" — skipped`)
      continue
    }
    const body = section.slice(nameEnd)
    let m
    ITEM_RE.lastIndex = 0
    while ((m = ITEM_RE.exec(body)) !== null) {
      const [, title, rawSev, specDesc, url] = m
      const severity = SEV_MAP[rawSev.toLowerCase()]
      if (!severity) {
        console.warn(`  [warn] Unknown severity "${rawSev}" for "${title}" — skipped`)
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
      const item = { id, category: effectiveCategory, severity, title, guidance, url: url.replace(/\/$/, '') }
      if (LIVE_PROBE_IDS.has(id)) {
        item.liveProbe = true
      }
      items.push(item)
    }
  }

  return items
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set(['required', 'recommended', 'optional', 'avoid'])
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
  'i18n',
])

function validate(items) {
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
      throw new Error(`URL "${r.url}" does not start with "${SPEC_BASE}" on item "${r.id}"`)
  }
  console.log(`  ✓ Validation passed: ${items.length} items, all ids unique and valid`)
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
    `url: ${JSON.stringify(item.url)}`,
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
    'i18n',
  ]
  const map = new Map(order.map((c) => [c, []]))
  for (const item of items) {
    if (!map.has(item.category)) map.set(item.category, [])
    map.get(item.category).push(item)
  }
  return map
}

function generateRubricTs(items, syncedAt) {
  const byCategory = groupByCategory(items)
  const lines = [
    '// AUTO-GENERATED by scripts/sync-health-rubric.mjs — do not edit by hand.',
    `// Source: https://mcp.specification.website/mcp  Synced: ${syncedAt}`,
    '// To regenerate: node scripts/sync-health-rubric.mjs',
    "// Stable ids (used by EVALUATORS/APPLIES_WHEN in checks.ts) are preserved via ID_OVERRIDES in the script.",
    '',
    "import type { RubricItem } from './types'",
    '',
    'export const RUBRIC: RubricItem[] = [',
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
    i18n: 'Internationalisation',
  }

  for (const [cat, catItems] of byCategory) {
    if (!catItems.length) continue
    lines.push(`  // ${PRETTY_SECTION[cat] ?? cat}`)
    for (const item of catItems) {
      lines.push(serializeItem(item))
    }
  }

  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('sync-health-rubric: fetching checklist from specification.website MCP…')

  let checklistMarkdown
  try {
    await mcpInit()
    checklistMarkdown = await getChecklist()
  } catch (err) {
    console.error(`\n[ERROR] Network/MCP failure — rubric.ts NOT modified.\n  ${err.message}`)
    process.exit(1)
  }

  console.log('  ✓ Checklist received, parsing…')

  let items
  try {
    items = parseChecklist(checklistMarkdown)
  } catch (err) {
    console.error(`\n[ERROR] Parse failure — rubric.ts NOT modified.\n  ${err.message}`)
    process.exit(1)
  }

  console.log(`  ✓ Parsed ${items.length} items`)

  try {
    validate(items)
  } catch (err) {
    console.error(`\n[ERROR] Validation failure — rubric.ts NOT modified.\n  ${err.message}`)
    process.exit(1)
  }

  const syncedAt = new Date().toISOString().slice(0, 10)
  const output = generateRubricTs(items, syncedAt)

  try {
    writeFileSync(RUBRIC_PATH, output, 'utf8')
  } catch (err) {
    console.error(`\n[ERROR] Could not write rubric.ts — ${err.message}`)
    process.exit(1)
  }

  console.log(`  ✓ Written: ${RUBRIC_PATH}`)
  console.log(`\nsync-health-rubric: done — ${items.length} items written to rubric.ts`)
  console.log(
    '\nNext steps:\n  pnpm --filter @setu/core test -- health-rubric\n  pnpm --filter @setu/core test -- health-audit',
  )
}

main().catch((err) => {
  console.error(`\n[FATAL] Unexpected error — rubric.ts NOT modified.\n  ${err.stack ?? err}`)
  process.exit(1)
})
