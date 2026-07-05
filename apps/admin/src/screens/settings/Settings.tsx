import { useEffect, useState } from 'react'
import { PageHeader } from '../../shell/PageHeader'
import { PageBody } from '../../shell/PageBody'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GeneralSettings } from './GeneralSettings'
import { ReadingSettings } from './ReadingSettings'
import { MediaSettings } from './MediaSettings'
import { IdentitySettings } from './IdentitySettings'
import { apiFetch } from '../../lib/api-fetch'
import { useCan } from '../../auth/actor'

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
const BASE_GROUPS: { id: GroupId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'reading', label: 'Content & Reading' },
  { id: 'media', label: 'Media' },
  { id: 'identity', label: 'Identity & SEO' },
  { id: 'forms', label: 'Forms' },
]
const COMING_SOON = ['Deploy']

export function Settings() {
  const [active, setActive] = useState<GroupId>('general')
  // #248: Users & Roles moved out of Settings to a top-level screen (/users, gated on
  // `users.view`) — see AppSidebar/app.tsx/UsersScreen. Settings no longer has a users group.
  const groups = BASE_GROUPS
  // Settings is visible to `settings.view` (maintainer+) but only editable by `settings.manage`
  // (admin). The server already enforces this on the write path (the settings-aware git gate in
  // apps/api/src/app.ts) — so a maintainer save would 403. Rather than let them edit and hit that
  // error, present the whole surface read-only via a disabled <fieldset> (which natively disables
  // every nested control, including the Save buttons in each group).
  const canManage = useCan()('settings.manage')

  return (
    <>
      <PageHeader title="Settings" />
      <PageBody>
        <div className="flex gap-6">
          <nav className="w-48 shrink-0 space-y-1" aria-label="Settings sections">
            {groups.map((g) => (
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
            {!canManage && (
              <div className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                You have view-only access to settings. Only an admin can change them.
              </div>
            )}
            <fieldset disabled={!canManage} className="m-0 min-w-0 border-0 p-0">
              {active === 'general' ? (
                <GeneralSettings />
              ) : active === 'reading' ? (
                <ReadingSettings />
              ) : active === 'media' ? (
                <MediaSettings />
              ) : active === 'identity' ? (
                <IdentitySettings />
              ) : (
                <FormsGroup />
              )}
            </fieldset>
          </div>
        </div>
      </PageBody>
    </>
  )
}
