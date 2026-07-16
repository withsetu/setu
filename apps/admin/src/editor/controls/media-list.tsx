import { useState } from 'react'
import { galleryImagesOf } from '@setu/blocks'
import type { GalleryImage } from '@setu/blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Icon } from '../../ui/Icon'
import { MediaPickerModal } from '../MediaPickerModal'
import { resolveMediaSrc } from '../media-src'
import type { ControlProps } from './types'

/** Ordered multi-image picker for Array props (the gallery's `images`). Reuses the
 *  shared MediaPickerModal/MediaBrowser in multi-pick mode to append images, and
 *  renders one row per image: thumbnail, per-image alt + caption, and up/down/remove
 *  reordering. Writes the whole array back through onChange. */
export function MediaListControl({ value, onChange, meta }: ControlProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const items = galleryImagesOf(value)

  const patch = (index: number, field: 'alt' | 'caption', raw: string) => {
    onChange(
      items.map((item, i) => {
        if (i !== index) return item
        const next = { ...item }
        if (raw === '') delete next[field]
        else next[field] = raw
        return next
      })
    )
  }
  const move = (index: number, delta: -1 | 1) => {
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved!)
    onChange(next)
  }
  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }
  const append = (src: string) => {
    onChange([...items, { src } satisfies GalleryImage])
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <ul
          className="flex list-none flex-col gap-2 p-0"
          aria-label={meta.name}
        >
          {items.map((item, i) => (
            <li
              key={`${item.src}-${i}`}
              className="flex gap-2 rounded-md border border-border p-2"
            >
              <img
                src={resolveMediaSrc(item.src, meta.apiBase || undefined)}
                alt=""
                className="h-[4.5rem] w-14 shrink-0 rounded object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Input
                  value={item.alt ?? ''}
                  placeholder="Alt text"
                  aria-label={`Alt text for image ${i + 1}`}
                  onChange={(e) => patch(i, 'alt', e.target.value)}
                  className="h-8"
                />
                <Input
                  value={item.caption ?? ''}
                  placeholder="Caption"
                  aria-label={`Caption for image ${i + 1}`}
                  onChange={(e) => patch(i, 'caption', e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="flex flex-col items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`Move image ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="chevUp" size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`Move image ${i + 1} down`}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="chevDown" size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove image ${i + 1}`}
                  onClick={() => remove(i)}
                >
                  <Icon name="x" size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => setPickerOpen(true)}
        className={
          items.length === 0
            ? 'h-24 w-full border-dashed text-muted-foreground'
            : 'w-full border-dashed text-muted-foreground'
        }
      >
        <Icon name="plus" size={16} className="mr-1.5" />
        Add images
      </Button>
      <MediaPickerModal
        apiBase={meta.apiBase}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={append}
        multi
        pickedCount={items.length}
        title="Add images"
      />
    </div>
  )
}
