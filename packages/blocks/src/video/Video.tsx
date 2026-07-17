import './video.css'
import { videoPlaybackAttrs, videoClasses } from './video-attrs'

export interface VideoProps {
  src?: string
  poster?: string
  caption?: string
  controls?: boolean
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  width?: string
}

/** The video visual core. Rendered read-only in the editor canvas (props from the node's
 *  mdAttrs); the site mirrors this exact class structure in Video.astro, sharing
 *  video.css and videoPlaybackAttrs. With no src it renders an inviting placeholder —
 *  the canvas must never show `undefined` or a broken player. The canvas never
 *  autoplays: a video starting itself mid-edit is a nuisance, so `autoplay` is shown by
 *  the inspector state, not performed. */
export function Video({
  src,
  poster,
  caption,
  controls,
  autoplay,
  loop,
  muted,
  width
}: VideoProps) {
  if (!src) {
    return (
      <figure className={videoClasses(width)}>
        <div className="blk-video-empty">
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="6" width="14" height="12" rx="2.4" />
            <path d="m22 8-6 4 6 4z" />
          </svg>
          <span>
            No video yet — pick one from the library in the block panel.
          </span>
        </div>
      </figure>
    )
  }
  const play = videoPlaybackAttrs({ controls, autoplay, loop, muted })
  return (
    <figure className={videoClasses(width)}>
      <video
        className="blk-video-player"
        src={src}
        poster={poster || undefined}
        controls={play.controls}
        loop={play.loop}
        muted={play.muted}
        playsInline={play.playsInline}
        // deliberately no `autoplay` attribute in the canvas (see docblock); the
        // data attribute keeps the state visible/testable without playback.
        data-autoplay={play.autoplay ? '' : undefined}
        preload="metadata"
      />
      {caption ? (
        <figcaption className="blk-video-caption">{caption}</figcaption>
      ) : null}
    </figure>
  )
}
