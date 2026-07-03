import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function SiteDeployCard({
  url,
  deployedSha
}: {
  url: string
  deployedSha: string | null
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">
          Site &amp; deploy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm hover:underline"
        >
          {hostOf(url)}
        </a>
        <p className="text-xs text-muted-foreground">
          {deployedSha === null ? (
            'Not deployed yet'
          ) : (
            <>
              Deployed ·{' '}
              <span className="font-mono">{deployedSha.slice(0, 7)}</span>
            </>
          )}
        </p>
        <Button asChild variant="outline" size="sm" className="w-full">
          <a href={url} target="_blank" rel="noopener noreferrer">
            View site
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}
