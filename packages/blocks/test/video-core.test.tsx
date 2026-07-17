import { render } from '@testing-library/react'
import { Video } from '../src/video/Video'
import { videoPlaybackAttrs } from '../src/video/video-attrs'

describe('videoPlaybackAttrs', () => {
  test('defaults: controls on, everything else off', () => {
    expect(videoPlaybackAttrs({})).toEqual({
      controls: true,
      autoplay: false,
      loop: false,
      muted: false,
      playsInline: false
    })
  })

  test('autoplay forces muted + playsInline (browsers refuse unmuted autoplay)', () => {
    expect(videoPlaybackAttrs({ autoplay: true, muted: false })).toEqual({
      controls: true,
      autoplay: true,
      loop: false,
      muted: true,
      playsInline: true
    })
  })

  test('explicit values pass through when autoplay is off', () => {
    expect(
      videoPlaybackAttrs({ controls: false, loop: true, muted: true })
    ).toEqual({
      controls: false,
      autoplay: false,
      loop: true,
      muted: true,
      playsInline: false
    })
  })
})

describe('Video core (editor canvas)', () => {
  test('no src → inviting placeholder, never "undefined" on screen', () => {
    const { container } = render(<Video />)
    const empty = container.querySelector('.blk-video-empty')
    expect(empty).toBeTruthy()
    expect(empty?.textContent).toMatch(/video/i)
    expect(container.textContent).not.toContain('undefined')
    expect(container.querySelector('video')).toBeNull()
  })

  test('src → <video> with poster, controls and caption', () => {
    const { container } = render(
      <Video
        src="/media/clip.mp4"
        poster="/media/poster.webp"
        caption="A clip"
      />
    )
    const video = container.querySelector<HTMLVideoElement>(
      'figure.blk-video video.blk-video-player'
    )
    expect(video).toBeTruthy()
    expect(video?.getAttribute('src')).toBe('/media/clip.mp4')
    expect(video?.getAttribute('poster')).toBe('/media/poster.webp')
    expect(video?.hasAttribute('controls')).toBe(true)
    expect(video?.getAttribute('preload')).toBe('metadata')
    expect(container.querySelector('figcaption')?.textContent).toBe('A clip')
  })

  test('autoplay renders muted even when muted prop is false — but never plays in the canvas', () => {
    const { container } = render(
      <Video src="/media/clip.mp4" autoplay muted={false} />
    )
    const video = container.querySelector('video')
    // React reflects `muted` as a property, not an attribute — assert the property.
    expect((video as HTMLVideoElement).muted).toBe(true)
    // the canvas marks autoplay state without performing it (no mid-edit playback)
    expect(video?.hasAttribute('autoplay')).toBe(false)
    expect(video?.hasAttribute('data-autoplay')).toBe(true)
    expect(video?.hasAttribute('playsinline')).toBe(true)
  })

  test('width maps to the w- intent classes the theme breaks out', () => {
    const { container } = render(<Video src="/media/clip.mp4" width="full" />)
    expect(container.querySelector('figure.blk-video.w-full')).toBeTruthy()
  })
})
