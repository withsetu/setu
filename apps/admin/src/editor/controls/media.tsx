import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resolveMediaSrc } from '../media-src'
import { toDisplayString, type ControlProps } from './types'

/** Empty-state URL entry for the video control: the block also accepts a direct URL
 *  to a video FILE (e.g. an already-hosted mp4) — provider pages (YouTube/Vimeo)
 *  belong to the embed block. Enter commits. */
function VideoUrlEntry({ onCommit }: { onCommit: (url: string) => void }) {
  const [url, setUrl] = useState('')
  const commit = () => {
    const trimmed = url.trim()
    if (/^https?:\/\//i.test(trimmed)) onCommit(trimmed)
  }
  return (
    <Input
      type="url"
      placeholder="…or paste a video file URL"
      aria-label="Video file URL"
      value={url}
      onChange={(e) => setUrl(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
      onBlur={commit}
    />
  )
}

function MediaControlBase({
  value,
  onChange,
  meta,
  kind
}: ControlProps & { kind: 'image' | 'video' }) {
  const src = value
    ? resolveMediaSrc(toDisplayString(value, ''), meta.apiBase || undefined)
    : ''
  if (!src) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          aria-label={meta.name}
          onClick={() => meta.onPickMedia(meta.name)}
          className="h-24 w-full border-dashed text-muted-foreground"
        >
          Choose from library
        </Button>
        {kind === 'video' ? (
          <VideoUrlEntry onCommit={(url) => onChange(url)} />
        ) : null}
      </div>
    )
  }
  if (kind === 'video') {
    // A video preview keeps its native controls usable, so Replace/Remove sit
    // below the player instead of the image control's hover overlay.
    return (
      <div className="flex flex-col gap-2">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- inspector preview
            of the author's own file; Setu can't synthesize a caption track for it */}
        <video
          src={src}
          controls
          preload="metadata"
          className="block max-h-40 w-full rounded-md border border-border bg-black"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={`Replace ${meta.name}`}
            onClick={() => meta.onPickMedia(meta.name)}
          >
            Replace
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={`Remove ${meta.name}`}
            onClick={() => onChange('')}
          >
            Remove
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="group relative overflow-hidden rounded-md border border-border">
      <img src={src} alt="" className="block max-h-40 w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 flex gap-2 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={`Replace ${meta.name}`}
          onClick={() => meta.onPickMedia(meta.name)}
        >
          Replace
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={`Remove ${meta.name}`}
          onClick={() => onChange('')}
        >
          Remove
        </Button>
      </div>
    </div>
  )
}

export function MediaControl(props: ControlProps) {
  return <MediaControlBase {...props} kind="image" />
}

/** The 'video' control — same pick/replace/remove flow as MediaControl, but the
 *  library opens filtered to video files and the preview is a real player. */
export function VideoControl(props: ControlProps) {
  return <MediaControlBase {...props} kind="video" />
}
