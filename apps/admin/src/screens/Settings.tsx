import { useEffect, useState } from 'react'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function SpamProtectionStatus({ apiBase }: { apiBase: string }) {
  const [status, setStatus] = useState<{ provider: string; secretConfigured: boolean } | null>(null)
  useEffect(() => {
    void fetch(`${apiBase}/forms/captcha-status`)
      .then((r) => r.json() as Promise<{ provider: string; secretConfigured: boolean }>)
      .then(setStatus)
      .catch(() => setStatus({ provider: '', secretConfigured: false }))
  }, [apiBase])
  if (!status) return null
  const label = !status.provider
    ? 'Spam protection: not configured'
    : status.secretConfigured
      ? `Spam protection: ${status.provider} — secret detected ✓`
      : `Spam protection: ${status.provider} — secret missing ⚠ (set SETU_${status.provider.toUpperCase()}_SECRET)`
  return <p className="text-sm text-muted-foreground">{label}</p>
}

const apiBase = import.meta.env.VITE_SETU_API as string | undefined

export function Settings() {
  return (
    <>
      <PageHeader title="Settings" />
      <PageBody>
        <div className="max-w-xl space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Forms</CardTitle>
            </CardHeader>
            <CardContent>
              {apiBase ? (
                <SpamProtectionStatus apiBase={apiBase} />
              ) : (
                <p className="text-sm text-muted-foreground">Spam protection: not configured</p>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
