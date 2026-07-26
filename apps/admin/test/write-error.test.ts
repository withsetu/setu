import { describe, it, expect } from 'vitest'
import { GitApiError } from '@setu/git-http'
import { writeError } from '../src/ui/error-message'

const validation = (fields: string[]) =>
  new GitApiError(
    422,
    JSON.stringify({
      error: 'invalid entry fields',
      issues: fields.map((field) => ({
        path: 'content/product/en/x.mdoc',
        field,
        message: 'Required'
      }))
    })
  )

describe('writeError', () => {
  // The defect this exists for: before #253 every publish failure said "check your
  // connection", which is false for a server that answered and refused.
  it('names the required fields for a 422, and never blames the connection', () => {
    const msg = writeError(validation(['sku', 'category']), 'publish')
    expect(msg).toBe("Couldn't publish — sku, category are required.")
    expect(msg).not.toMatch(/connection/i)
  })

  it('dedupes a field that produced several issues', () => {
    expect(writeError(validation(['sku', 'sku']), 'publish')).toBe(
      "Couldn't publish — sku is required."
    )
  })

  it('falls back to the raw message when no issue names a field', () => {
    const err = new GitApiError(
      422,
      JSON.stringify({ issues: [{ path: 'p', field: '', message: 'Nope' }] })
    )
    expect(writeError(err, 'publish')).toBe("Couldn't publish — Nope.")
  })

  // "requires category" is false for a field that WAS supplied, just wrongly.
  it('does not call a present-but-invalid field missing', () => {
    const err = new GitApiError(
      422,
      JSON.stringify({
        issues: [
          { path: 'p', field: 'sku', message: 'Required' },
          {
            path: 'p',
            field: 'category',
            message: "Invalid enum value. Expected 'resin', received 'sealant'"
          }
        ]
      })
    )
    const msg = writeError(err, 'publish')
    expect(msg).toBe(
      "Couldn't publish — sku is required; category: Invalid enum value. Expected 'resin', received 'sealant'."
    )
  })

  it('caps a long issue list rather than dumping every zod message', () => {
    const err = new GitApiError(
      422,
      JSON.stringify({
        issues: ['a', 'b', 'c', 'd'].map((f) => ({
          path: 'p',
          field: f,
          message: 'Bad'
        }))
      })
    )
    expect(writeError(err, 'publish')).toBe(
      "Couldn't publish — a: Bad; b: Bad; and 2 more."
    )
  })

  it.each([
    [401, "Couldn't publish — your session has expired. Sign in again."],
    [403, "Couldn't publish — your role doesn't have permission for this."],
    [413, "Couldn't publish — that was too large to send."],
    [500, "Couldn't publish — the server had a problem (500). Try again."],
    [418, "Couldn't publish (server error 418)."]
  ])('maps status %i to its own message', (status, expected) => {
    expect(writeError(new GitApiError(status, '{}'), 'publish')).toBe(expected)
  })

  // The ONLY case "check your connection" is true of: the request never got a reply.
  it.each([
    ['a bare Error', new Error('Failed to fetch')],
    ['a non-Error rejection', 'nope'],
    ['undefined', undefined]
  ])('reports %s as a connection problem', (_label, err) => {
    expect(writeError(err, 'save the draft')).toBe(
      "Couldn't save the draft. Check your connection and try again."
    )
  })
})
