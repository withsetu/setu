import { useEffect, useState } from 'react'
import { PageHeader } from '../../shell/PageHeader'
import { PageBody } from '../../shell/PageBody'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GeneralSettings } from './GeneralSettings'
import { ReadingSettings } from './ReadingSettings'
import { MediaSettings } from './MediaSettings'
import { IdentitySettings } from './IdentitySettings'
import { apiFetch } from '../../lib/api-fetch'

const apiBase = import.meta.env.VITE_SETU_API as string | undefined

// Moved verbatim from the previous flat Settings.tsx (captcha PR).
function SpamProtectionStatus({ apiBase }: { apiBase: string }) {
  const [status, setStatus] = useState<{ provider: string; secretConfigured: boolean } | null>(null)
  useEffect(() => {
    void apiFetch(`${apiBase}/forms/captcha-status`)
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

function FormsGroup() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Spam protection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {apiBase ? <SpamProtectionStatus apiBase={apiBase} /> : <p className="text-sm text-muted-foreground">Spam protection: not configured</p>}
        <p className="text-xs text-muted-foreground">More form settings coming soon.</p>
      </CardContent>
    </Card>
  )
}

type GroupId = 'general' | 'reading' | 'media' | 'identity' | 'forms'
const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'reading', label: 'Content & Reading' },
  { id: 'media', label: 'Media' },
  { id: 'identity', label: 'Identity & SEO' },
  { id: 'forms', label: 'Forms' },
]
const COMING_SOON = ['Users & Roles', 'Deploy']

export function Settings() {
  const [active, setActive] = useState<GroupId>('general')
  return (
    <>
      <PageHeader title="Settings" />
      <PageBody>
        <div className="flex gap-6">
          <nav className="w-48 shrink-0 space-y-1" aria-label="Settings sections">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setActive(g.id)}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-sm ${active === g.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {g.label}
              </button>
            ))}
            {COMING_SOON.map((label) => (
              <span key={label} className="block cursor-not-allowed rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground/50" title="Coming soon">
                {label}
              </span>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            {active === 'general' ? <GeneralSettings /> : active === 'reading' ? <ReadingSettings /> : active === 'media' ? <MediaSettings /> : active === 'identity' ? <IdentitySettings /> : <FormsGroup />}
          </div>
        </div>
      </PageBody>
    </>
  )
}
