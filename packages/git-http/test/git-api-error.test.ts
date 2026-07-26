import { describe, it, expect } from 'vitest'
import { GitApiError } from '../src/index'

describe('GitApiError', () => {
  it('carries the status and parses the field issues from a 422 body', () => {
    const err = new GitApiError(
      422,
      JSON.stringify({
        error: 'invalid entry fields',
        issues: [
          {
            path: 'content/product/en/x.mdoc',
            field: 'sku',
            message: 'Required'
          }
        ]
      })
    )
    expect(err.status).toBe(422)
    expect(err.issues).toEqual([
      { path: 'content/product/en/x.mdoc', field: 'sku', message: 'Required' }
    ])
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('GitApiError')
  })

  it.each([
    ['a non-JSON body', 'Internal Server Error'],
    ['an empty body', ''],
    ['JSON without issues', '{"error":"forbidden"}'],
    ['issues that are not an array', '{"issues":"nope"}'],
    ['JSON null', 'null']
  ])('yields no issues for %s, without throwing', (_label, body) => {
    const err = new GitApiError(500, body)
    expect(err.issues).toEqual([])
    expect(err.status).toBe(500)
  })

  it('drops malformed issue entries but keeps the well-formed ones', () => {
    const err = new GitApiError(
      422,
      JSON.stringify({ issues: [{ field: 'sku' }, { message: 'Required' }] })
    )
    expect(err.issues).toEqual([{ path: '', field: '', message: 'Required' }])
  })
})
