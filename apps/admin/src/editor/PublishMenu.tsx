import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu'

export function PublishMenu({
  canSaveDraft,
  canPublish,
  canUnpublish,
  isUnpublished,
  onSaveDraft,
  onPublish,
  onUnpublish,
  onRepublish
}: {
  canSaveDraft: boolean
  canPublish: boolean
  canUnpublish: boolean
  isUnpublished: boolean
  onSaveDraft: () => void
  onPublish: () => void
  onUnpublish: () => void
  onRepublish: () => void
}) {
  if (!canSaveDraft && !canPublish && !canUnpublish) return null
  const items = [
    {
      key: 'unpublish',
      label: 'Unpublish',
      run: onUnpublish,
      show: canUnpublish && !isUnpublished
    },
    {
      key: 'republish',
      label: 'Re-publish',
      run: onRepublish,
      show: canPublish && isUnpublished
    }
  ].filter((i) => i.show)
  return (
    <div className="inline-flex items-center gap-2">
      {canSaveDraft && (
        <Button size="sm" variant="outline" onClick={onSaveDraft}>
          Save draft
        </Button>
      )}
      {canPublish && (
        <Button
          size="sm"
          className={items.length > 0 ? 'rounded-r-none' : ''}
          onClick={onPublish}
        >
          Publish
        </Button>
      )}
      {items.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant={canPublish ? 'default' : 'outline'}
              aria-label="More publish actions"
              className={
                canPublish
                  ? 'rounded-l-none border-l border-l-primary-foreground/25 px-2'
                  : 'px-2'
              }
            >
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {items.map((i) => (
              <DropdownMenuItem key={i.key} onSelect={() => i.run()}>
                {i.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
