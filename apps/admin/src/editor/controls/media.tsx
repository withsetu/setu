import { Button } from '@/components/ui/button'
import { resolveMediaSrc } from '../media-src'
import { toDisplayString, type ControlProps } from './types'

export function MediaControl({ value, onChange, meta }: ControlProps) {
  const src = value ? resolveMediaSrc(toDisplayString(value, ''), meta.apiBase || undefined) : ''
  if (!src) {
    return (
      <Button type="button" variant="outline" aria-label={meta.name} onClick={() => meta.onPickMedia(meta.name)}
        className="h-24 w-full border-dashed text-muted-foreground">
        Choose from library
      </Button>
    )
  }
  return (
    <div className="group relative overflow-hidden rounded-md border border-border">
      <img src={src} alt="" className="block max-h-40 w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 flex gap-2 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <Button type="button" size="sm" variant="secondary" aria-label={`Replace ${meta.name}`}
          onClick={() => meta.onPickMedia(meta.name)}>Replace</Button>
        <Button type="button" size="sm" variant="secondary" aria-label={`Remove ${meta.name}`}
          onClick={() => onChange('')}>Remove</Button>
      </div>
    </div>
  )
}
