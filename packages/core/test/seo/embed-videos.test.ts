import { describe, it, expect } from 'vitest'
import { extractEmbedVideos } from '../../src/seo/embed-videos'

const vid = (extra = '') =>
  `{% embed mediaType="video" title="The Mountain" thumbnailUrl="https://i.vimeocdn.com/x.jpg" embedUrl="https://player.vimeo.com/video/1" caption="A classic" ${extra}/%}`

describe('extractEmbedVideos', () => {
  it('extracts a video embed into the fields <video:video> needs', () => {
    expect(extractEmbedVideos(`intro\n\n${vid()}\n\nmore`)).toEqual([
      {
        title: 'The Mountain',
        thumbnailUrl: 'https://i.vimeocdn.com/x.jpg',
        playerLoc: 'https://player.vimeo.com/video/1',
        description: 'A classic'
      }
    ])
  })

  it('parses titles that contain (escaped) quotes correctly — not a naive regex', () => {
    const body = `{% embed mediaType="video" title="The \\"Best\\" Video" thumbnailUrl="https://t/x.jpg" embedUrl="https://p/1" /%}`
    expect(extractEmbedVideos(body)[0]?.title).toBe('The "Best" Video')
  })

  it('ignores non-video embeds (audio/photo/rich)', () => {
    const audio = `{% embed mediaType="audio" title="Song" thumbnailUrl="https://t/a.jpg" embedUrl="https://p/a" /%}`
    expect(extractEmbedVideos(audio)).toEqual([])
  })

  it('skips a video embed missing any REQUIRED field (Google rejects incomplete entries)', () => {
    const noThumb = `{% embed mediaType="video" title="T" embedUrl="https://p/1" /%}`
    const noPlayer = `{% embed mediaType="video" title="T" thumbnailUrl="https://t/x.jpg" /%}`
    const noTitle = `{% embed mediaType="video" thumbnailUrl="https://t/x.jpg" embedUrl="https://p/1" /%}`
    expect(extractEmbedVideos(noThumb)).toEqual([])
    expect(extractEmbedVideos(noPlayer)).toEqual([])
    expect(extractEmbedVideos(noTitle)).toEqual([])
  })

  it('omits description when there is no caption', () => {
    const noCap = `{% embed mediaType="video" title="T" thumbnailUrl="https://t/x.jpg" embedUrl="https://p/1" /%}`
    expect(extractEmbedVideos(noCap)[0]).toEqual({
      title: 'T',
      thumbnailUrl: 'https://t/x.jpg',
      playerLoc: 'https://p/1'
    })
  })

  it('returns [] for an empty body, no embeds, or malformed markdoc (never throws)', () => {
    expect(extractEmbedVideos('')).toEqual([])
    expect(extractEmbedVideos('just prose, no blocks')).toEqual([])
    expect(extractEmbedVideos('{% embed mediaType="video" ')).toEqual([])
  })

  it('extracts multiple video embeds in document order', () => {
    const two = `${vid('title2="a" ')}\n\n${vid()}`
    expect(extractEmbedVideos(two)).toHaveLength(2)
  })
})
