import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePort } from './dev-port.mjs'

test('unset falls back to the caller default', () => {
  assert.equal(parsePort(undefined, 5173), 5173)
  assert.equal(parsePort(null, 5173), 5173)
  assert.equal(parsePort('', 5173), 5173)
  assert.equal(parsePort('   ', 5173), 5173)
})

test('a valid port is returned as a number', () => {
  assert.equal(parsePort('4321', 5173), 4321)
  assert.equal(parsePort(' 4321 ', 5173), 4321)
  assert.equal(parsePort('1', 5173), 1)
  assert.equal(parsePort('65535', 5173), 65535)
})

test('a typo is refused rather than silently falling back', () => {
  // #815's lesson from free-ports.mjs: `517e` swallowed as "no port" reported a busy port FREE.
  // Falling back here would be the same failure — the dev server would come up on the DEFAULT
  // port while the operator believes it is on theirs.
  for (const raw of ['517e', 'abc', '80.5', '5173px', '0x1000']) {
    assert.throws(() => parsePort(raw, 5173), /SETU_.*PORT|invalid port/i, raw)
  }
})

test('out-of-range values are refused', () => {
  for (const raw of ['0', '-1', '65536', '99999']) {
    assert.throws(() => parsePort(raw, 5173), /1-65535|1–65535/, raw)
  }
})

test('the refusal names the offending value', () => {
  assert.throws(() => parsePort('517e', 5173), /"517e"/)
})

test('the variable name appears in the message when supplied', () => {
  assert.throws(
    () => parsePort('nope', 5173, 'SETU_ADMIN_PORT'),
    /SETU_ADMIN_PORT/
  )
})
