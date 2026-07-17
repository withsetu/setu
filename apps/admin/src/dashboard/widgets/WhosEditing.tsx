import type { Lock } from '@setu/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

export function WhosEditing({ locks }: { locks: Lock[] }) {
  if (locks.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">
          Who's editing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {locks.map((l) => (
          <div
            key={`${l.collection}/${l.locale}/${l.slug}`}
            className="flex items-center gap-3"
          >
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">
                {initials(l.lockedBy)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              {/* #554: display names are free text — truncate, full name on hover. */}
              <div title={l.lockedBy} className="truncate text-sm font-medium">
                {l.lockedBy}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                editing "{l.slug}"
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
