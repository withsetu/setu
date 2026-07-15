import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { MediaPage } from '../pages/MediaPage'
import { ContentListPage } from '../pages/ContentListPage'
import { uniqueTitle } from '../lib/unique-title'

// #448: the media-upload journey — the seam between the /media screen (real
// dropzone upload → POST /media → sharp ingest → browser-side media index) and
// the editor's featured-image picker, which no unit layer crosses end-to-end.
//
// The fixture is a committed 163-byte 8×8 PNG (e2e/fixtures/tiny.png); its BYTES
// are fixed but its NAME is uniqued per run/project via `uniqueTitle` (delivered
// through setInputFiles' in-memory payload), because the server derives the media
// key from the filename and the sandbox media store is shared across projects —
// a fixed name would collide into `-2` suffixed keys and make tile assertions
// ambiguous.
const fixturePng = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'fixtures',
    'tiny.png'
  )
)

test('upload media through the real UI, use it as a featured image, and verify it persists', async ({
  page
}) => {
  // e.g. "chromium-upload-ab12cd.png" — lowercase-hyphenated so the on-disk media
  // key (mediaSlug of the filename) is predictable for the persistence assertion.
  const filename = `${uniqueTitle('upload').replace(/\s+/g, '-').toLowerCase()}.png`
  const fileSlug = filename.replace(/\.png$/, '')

  // 1 · Upload through the real dropzone on the Media screen.
  const media = new MediaPage(page)
  await media.goto()
  await media.upload({
    name: filename,
    mimeType: 'image/png',
    buffer: fixturePng
  })
  await expect(media.uploadedToast(filename)).toBeVisible()

  // 2 · It lands in the media library grid.
  await media.expectInGrid(filename)

  // 3 · New post → pick it as the featured image via the editor's media picker.
  const title = uniqueTitle('media-post')
  const list = new ContentListPage(page)
  await list.gotoPosts()
  const editor = await list.createPost()
  await editor.setTitle(title)
  await editor.setFeaturedImage(filename)
  await editor.save()

  // 4 · Persistence through the UI: back to the list, reopen, the featured image
  // reference survived the round-trip (the preview src resolves the stored
  // `/media/YYYY/MM/<slug>.png` key against the api origin).
  const listAfterSave = await editor.backToList()
  await listAfterSave.expectListed(title)
  const reopened = await listAfterSave.openPost(title)
  await expect(reopened.titleInput).toHaveValue(title)
  await expect(reopened.featuredPreview).toBeVisible()
  await expect(reopened.featuredPreview).toHaveAttribute(
    'src',
    new RegExp(`/media/\\d{4}/\\d{2}/${fileSlug}\\.png$`)
  )
})
