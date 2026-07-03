import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MediaPickerModal } from './MediaPickerModal'
import { resolveMediaSrc } from './media-src'

export function FeaturedImageField({
  value,
  onChange,
  editable,
  apiBase
}: {
  value?: string
  onChange: (next: string | undefined) => void
  editable: boolean
  apiBase: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div className="space-y-2.5">
      {value ? (
        <div className="space-y-2">
          <img
            src={resolveMediaSrc(value, apiBase)}
            alt="Featured image preview"
            className="aspect-video w-full rounded-md border border-border/60 object-cover"
          />
          {editable && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPickerOpen(true)}
              >
                Change
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => onChange(undefined)}
              >
                <X className="size-3" /> Remove
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!editable}
          onClick={() => setPickerOpen(true)}
        >
          Set featured image
        </Button>
      )}
      <MediaPickerModal
        apiBase={apiBase}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(src) => {
          onChange(src)
          setPickerOpen(false)
        }}
      />
    </div>
  )
}
