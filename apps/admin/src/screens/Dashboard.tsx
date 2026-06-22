import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { ContentRow, Lock } from '@setu/core'
import { useServices } from '../data/store'
import { useDeploy } from '../deploy/deploy'
import { useCan } from '../auth/actor'
import { siteUrl } from '../shell/site-url'
import { PageHeader } from '../shell/PageHeader'
import { Button } from '@/components/ui/button'
import { loadDashboardEntries, dashboardCounts, recentEntries, loadActiveLocks } from '../dashboard/entries'
import { greeting } from '../dashboard/format'
import { DashboardSkeleton } from '../dashboard/DashboardSkeleton'
import { ResumeEditing } from '../dashboard/widgets/ResumeEditing'
import { StatTiles } from '../dashboard/widgets/StatTiles'
import { SiteDeployCard } from '../dashboard/widgets/SiteDeployCard'
import { WhosEditing } from '../dashboard/widgets/WhosEditing'
import { GettingStarted } from '../dashboard/widgets/GettingStarted'

function HeaderActions() {
  const can = useCan()
  const { deploy } = useDeploy()
  const [busy, setBusy] = useState(false)
  const onDeploy = () => { setBusy(true); void deploy().finally(() => setBusy(false)) }
  return (
    <div className="flex items-center gap-2">
      <Button asChild><Link to="/edit/post/en/new"><Plus className="size-4" />New post</Link></Button>
      <Button asChild variant="outline"><Link to="/edit/page/en/new">New page</Link></Button>
      {can('site.deploy') && (
        <Button variant="outline" disabled={busy} onClick={onDeploy}>{busy ? 'Deploying…' : 'Deploy'}</Button>
      )}
    </div>
  )
}

export function Dashboard() {
  const { data, git } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [locks, setLocks] = useState<Lock[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      setError(false)
      try {
        const loaded = await loadDashboardEntries(data, git, deployedAt)
        if (!live) return
        setRows(loaded)
        setLocks(await loadActiveLocks(data, loaded))
      } catch {
        if (live) setError(true)
      }
    })()
    return () => { live = false }
  }, [data, git, deployedAt, deploySha])

  const counts = dashboardCounts(rows ?? [])
  const hasDeployed = deploySha !== null
  const url = siteUrl()

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`${greeting()} — here's your site at a glance.`} actions={<HeaderActions />} />
      <div className="page-body space-y-5">
        {error && <p className="text-sm text-destructive">Couldn't load your dashboard. Try refreshing.</p>}
        {rows === null && !error ? (
          <DashboardSkeleton />
        ) : (
          <>
            <GettingStarted hasSiteUrl={url !== ''} hasPost={counts.posts > 0} hasDeployed={hasDeployed} />
            <ResumeEditing rows={recentEntries(rows ?? [], 5)} />
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTiles posts={counts.posts} pages={counts.pages} published={counts.published} drafts={counts.drafts} />
              <SiteDeployCard url={url} deployedSha={deploySha} />
              <WhosEditing locks={locks} />
            </div>
          </>
        )}
      </div>
    </>
  )
}
