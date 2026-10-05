import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveMediaDir } from '../src/media-dir'

describe('resolveMediaDir (#1161)', () => {
  it('defaults to <repoDir>/.setu/uploads', () => {
    expect(resolveMediaDir({}, '/srv/content')).toBe(
      join('/srv/content', '.setu', 'uploads')
    )
  })
  it('an explicit SETU_MEDIA_DIR wins', () => {
    expect(
      resolveMediaDir({ SETU_MEDIA_DIR: '/var/media' }, '/srv/content')
    ).toBe('/var/media')
  })
  it('a blank SETU_MEDIA_DIR is treated as unset, not as the cwd', () => {
    expect(resolveMediaDir({ SETU_MEDIA_DIR: '  ' }, '/srv/content')).toBe(
      join('/srv/content', '.setu', 'uploads')
    )
  })
})
