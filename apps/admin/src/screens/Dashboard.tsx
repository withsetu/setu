import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { ContentRow, Lock } from '@setu/core'
import { useServices } from '../data/store'
import { useCan } from '../auth/actor'
import { useDeploy } from '../deploy/deploy'
import { siteUrl } from '../shell/site-url'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { Button } from '@/components/ui/button'
import {
  loadDashboardEntries,
  dashboardCounts,
  recentEntries,
  loadActiveLocks
} from '../dashboard/entries'
import { greeting } from '../lib/format'
import { ResumeEditing } from '../dashboard/widgets/ResumeEditing'
import { StatTiles } from '../dashboard/widgets/StatTiles'
import { SiteDeployCard } from '../dashboard/widgets/SiteDeployCard'
import { WhosEditing } from '../dashboard/widgets/WhosEditing'
import { GettingStarted } from '../dashboard/widgets/GettingStarted'
import { SiteHealthCard } from './dashboard/SiteHealthCard'

function HeaderActions() {
  // #362: creating content requires content.create — an actor without it gets no "New" buttons
  // (the server also rejects the resulting git write). Every current staff role holds it, so the
  // gate is defensive (future audience/read-only roles land in #379). Nothing to show without it.
  const can = useCan()
  if (!can('content.create')) return null
  return (
    <div className="flex items-center gap-2">
      <Button asChild>
        <Link to="/edit/post/en/new">
          <Plus className="size-4" />
          New post
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link to="/edit/page/en/new">New page</Link>
      </Button>
    </div>
  )
}

export function Dashboard() {
  const { data, git } = useServices()
  const can = useCan()
  const { status: deployStatus, deployInfo } = useDeploy()
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [locks, setLocks] = useState<Lock[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      setError(false)
      try {
        const loaded = await loadDashboardEntries(data, git, deployInfo())
        if (!live) return
        setRows(loaded)
        setLocks(await loadActiveLocks(data, loaded))
      } catch {
        if (live) setError(true)
      }
    })()
    return () => {
      live = false
    }
  }, [data, git, deployInfo, deployStatus])

  const counts = dashboardCounts(rows ?? [])
  const hasDeployed = deployStatus !== null && deployStatus.deployedSha !== null
  const url = siteUrl()
  // #572: paint every widget's Card shell immediately and let the numbers/rows shimmer
  // while entries load — no coarse gray blocks, no late pop-in at scale.
  const loading = rows === null && !error

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${greeting()} — here's your site at a glance.`}
        actions={<HeaderActions />}
      />
      <PageBody className="space-y-5">
        {error && (
          <p className="text-sm text-destructive">
            Couldn't load your dashboard. Try refreshing.
          </p>
        )}
        {/* GettingStarted and WhosEditing render nothing at all in their common case
            (set-up site / no locks) — a skeleton that usually vanishes would be a
            layout-shift of its own, so they stay hidden until the data lands. */}
        {!loading && (
          <GettingStarted
            hasSiteUrl={url !== ''}
            hasPost={counts.posts > 0}
            hasDeployed={hasDeployed}
          />
        )}
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <StatTiles
              loading={loading}
              posts={counts.posts}
              pages={counts.pages}
              published={counts.published}
              drafts={counts.drafts}
            />
            {/* #362: deploy + site-health are Maintainer+/Admin concerns (site.deploy /
                sitehealth.view) — hide the cards for content roles rather than leak ops data. */}
            {can('site.deploy') && (
              <SiteDeployCard
                url={url}
                status={deployStatus}
                loading={loading}
              />
            )}
            {can('sitehealth.view') && <SiteHealthCard />}
            {!loading && <WhosEditing locks={locks} />}
          </div>
          <ResumeEditing
            loading={loading}
            rows={recentEntries(rows ?? [], 5)}
          />
        </div>
      </PageBody>
    </>
  )
}
