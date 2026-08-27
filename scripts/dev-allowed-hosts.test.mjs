import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAllowedHosts } from './dev-allowed-hosts.mjs'

test('unset leaves the dev server on its own loopback-only default', () => {
  assert.equal(parseAllowedHosts(undefined), undefined)
  assert.equal(parseAllowedHosts(null), undefined)
})

test('an empty or whitespace-only value is the same as unset', () => {
  assert.equal(parseAllowedHosts(''), undefined)
  assert.equal(parseAllowedHosts('   '), undefined)
  assert.equal(parseAllowedHosts(' , , '), undefined)
})

test('a single host becomes a one-entry allowlist', () => {
  assert.deepEqual(parseAllowedHosts('admin.example.com'), [
    'admin.example.com'
  ])
})

test('a comma-separated list is split and trimmed, blanks dropped', () => {
  assert.deepEqual(
    parseAllowedHosts(' admin.example.com , , site.example.com '),
    ['admin.example.com', 'site.example.com']
  )
})

test("vite's leading-dot subdomain form is preserved", () => {
  assert.deepEqual(parseAllowedHosts('.example.com'), ['.example.com'])
})

test('an unbounded value is refused rather than silently disabling the host check', () => {
  for (const raw of ['true', 'TRUE', '*', 'admin.example.com,true']) {
    assert.throws(
      () => parseAllowedHosts(raw),
      /SETU_DEV_ALLOWED_HOSTS/,
      `expected ${JSON.stringify(raw)} to be refused`
    )
  }
})

test('the refusal names the offending value so the fix is obvious', () => {
  assert.throws(() => parseAllowedHosts('*'), /"\*"/)
})
