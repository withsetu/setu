import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'

export function PublishMenu({
  canPublish,
  canUnpublish,
  isUnpublished,
  onPublish,
  onUnpublish,
  onRepublish,
}: {
  canPublish: boolean
  canUnpublish: boolean
  isUnpublished: boolean
  onPublish: () => void
  onUnpublish: () => void
  onRepublish: () => void
}) {
  if (!canPublish && !canUnpublish) return null
  const items = [
    { key: 'unpublish', label: 'Unpublish', run: onUnpublish, show: canUnpublish && !isUnpublished },
    { key: 'republish', label: 'Re-publish', run: onRepublish, show: canPublish && isUnpublished },
  ].filter((i) => i.show)
  return (
    <div className="inline-flex items-center">
      {canPublish && (
        <Button size="sm" className={items.length > 0 ? 'rounded-r-none' : ''} onClick={onPublish}>Publish</Button>
      )}
      {items.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant={canPublish ? 'default' : 'outline'}
              aria-label="More publish actions"
              className={canPublish ? 'rounded-l-none border-l border-l-primary-foreground/25 px-2' : 'px-2'}
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
