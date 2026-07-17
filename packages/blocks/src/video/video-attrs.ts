/** Playback flags shared by the site renderer (Video.astro) and the editor canvas core
 *  (Video.tsx) so the two can never drift on the one browser-reality rule: unmuted
 *  autoplay is refused by every modern browser, so `autoplay` implies `muted` (and
 *  `playsInline`, which iOS additionally requires for inline autoplay). */
export interface VideoPlaybackInput {
  controls?: boolean
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
}

export interface VideoPlaybackAttrs {
  controls: boolean
  autoplay: boolean
  loop: boolean
  muted: boolean
  playsInline: boolean
}

export function videoPlaybackAttrs(
  input: VideoPlaybackInput
): VideoPlaybackAttrs {
  const autoplay = input.autoplay === true
  return {
    controls: input.controls !== false,
    autoplay,
    loop: input.loop === true,
    muted: autoplay || input.muted === true,
    playsInline: autoplay
  }
}

/** Root classes: `.blk-video` plus the theme-breakout width intent (w-wide/w-full). */
export function videoClasses(width?: string): string {
  const cls = ['blk-video']
  if (width === 'wide' || width === 'full') cls.push(`w-${width}`)
  return cls.join(' ')
}
