import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadFile } from '../src/media/upload-client'

afterEach(() => vi.restoreAllMocks())
const file = new File([new Uint8Array([1, 2])], 'a.png', { type: 'image/png' })

describe('uploadFile', () => {
  it('posts FormData to <apiBase>/media and returns the parsed result', async () => {
    const result = {
      id: '2026/06/a',
      key: '2026/06/a.png',
      url: 'http://api/media/2026/06/a.png',
      contentType: 'image/png',
      size: 2,
      filename: 'a.png'
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    )
    const out = await uploadFile('http://api', file)
    expect(out).toEqual(result)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://api/media')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('throws the server error message on a non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'unsupported type: image/svg+xml' }),
        { status: 415 }
      )
    )
    await expect(uploadFile('http://api', file)).rejects.toThrow(
      'unsupported type: image/svg+xml'
    )
  })
})
