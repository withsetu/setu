import { Check, Circle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDismissed } from '@/hooks/use-dismissed'

function Item({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {done ? (
        <Check className="size-4 text-success" aria-hidden />
      ) : (
        <Circle className="size-4 text-muted-foreground" aria-hidden />
      )}
      <span className={done ? 'text-muted-foreground line-through' : ''}>
        {label}
      </span>
    </li>
  )
}

export function GettingStarted({
  hasSiteUrl,
  hasPost,
  hasDeployed
}: {
  hasSiteUrl: boolean
  hasPost: boolean
  hasDeployed: boolean
}) {
  const { dismissed, dismiss } = useDismissed('getting-started')
  if (dismissed || (hasSiteUrl && hasPost && hasDeployed)) return null
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Getting started</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={dismiss}
          aria-label="Dismiss getting started"
        >
          Dismiss
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          <Item done={hasSiteUrl} label="Set your site URL" />
          <Item done={hasPost} label="Create your first post" />
          <Item done={hasDeployed} label="Deploy your site" />
        </ul>
      </CardContent>
    </Card>
  )
}
