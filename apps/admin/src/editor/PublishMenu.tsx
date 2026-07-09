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
  onUnpublish
}: {
  canSaveDraft: boolean
  canPublish: boolean
  canUnpublish: boolean
  isUnpublished: boolean
  onSaveDraft: () => void
  onPublish: () => void
  onUnpublish: () => void
}) {
  if (!canSaveDraft && !canPublish && !canUnpublish) return null
  // Publish always goes live (it clears published:false itself, subsuming the old
  // Re-publish item), so the only dropdown action left is Unpublish. The model is
  // the coherent triad: Save draft = commit as draft, Publish = commit live,
  // Unpublish = take down (#382).
  const items = [
    {
      key: 'unpublish',
      label: 'Unpublish',
      run: onUnpublish,
      show: canUnpublish && !isUnpublished
    }
  ].filter((i) => i.show)
  return (
    <div className="inline-flex items-center gap-2">
      {canSaveDraft && (
        <Button size="sm" variant="outline" onClick={onSaveDraft}>
          Save draft
        </Button>
      )}
      {(canPublish || items.length > 0) && (
        // Inner flush group so the split-button halves stay joined while the
        // outer gap-2 separates them from Save draft.
        <div className="inline-flex items-center">
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
      )}
    </div>
  )
}
