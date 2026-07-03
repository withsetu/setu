import { describe, it, expect } from 'vitest'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { createMediaIndexService } from './media-index-service'
import type { MediaRecord } from './types'

const rec = (
  mediaKey: string,
  over: Partial<MediaRecord> = {}
): MediaRecord => ({
  mediaKey,
  filename: `${mediaKey}.jpg`,
  key: `${mediaKey}.jpg`,
  thumbKey: null,
  contentType: 'image/jpeg',
  isImage: true,
  width: null,
  height: null,
  bytes: 0,
  uploadedAt: 0,
  ...over
})

describe('createMediaIndexService', () => {
  it('ensureBuilt hydrates from fetchRaw once; not again when version matches', async () => {
    let calls = 0
    const ix = createMemoryMediaIndexPort()
    const svc = createMediaIndexService({
      mediaIndex: ix,
      fetchRaw: async () => {
        calls++
        return [rec('a')]
      }
    })
    await svc.ensureBuilt()
    await svc.ensureBuilt()
    expect(calls).toBe(1)
    expect((await svc.query({ offset: 0, limit: 10 })).total).toBe(1)
  })
  it('refresh re-hydrates (clear + repopulate) every call', async () => {
    let batch: MediaRecord[] = [rec('a'), rec('b')]
    const svc = createMediaIndexService({
      mediaIndex: createMemoryMediaIndexPort(),
      fetchRaw: async () => batch
    })
    await svc.refresh()
    expect((await svc.query({ offset: 0, limit: 10 })).total).toBe(2)
    batch = [rec('a')] // 'b' deleted elsewhere
    await svc.refresh()
    expect(
      (await svc.query({ offset: 0, limit: 10 })).rows.map((r) => r.mediaKey)
    ).toEqual(['a'])
  })
  it('upsertOne / removeOne mutate optimistically', async () => {
    const svc = createMediaIndexService({
      mediaIndex: createMemoryMediaIndexPort(),
      fetchRaw: async () => []
    })
    await svc.ensureBuilt()
    await svc.upsertOne(rec('new'))
    expect((await svc.query({ offset: 0, limit: 10 })).total).toBe(1)
    await svc.removeOne('new')
    expect((await svc.query({ offset: 0, limit: 10 })).total).toBe(0)
  })
})
