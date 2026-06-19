import { useEffect, useState } from 'react'
import type { ContentRow, Lock } from '@setu/core'
import { useServices } from '../data/store'
import { useDeploy } from '../deploy/deploy'
import { siteUrl } from '../shell/site-url'
import { PageHeader } from '../shell/PageHeader'
import { loadDashboardEntries, dashboardCounts, recentEntries, loadActiveLocks } from '../dashboard/entries'
import { CountsTiles } from '../dashboard/widgets/CountsTiles'
import { RecentEdits } from '../dashboard/widgets/RecentEdits'
import { QuickActions } from '../dashboard/widgets/QuickActions'
import { WhosEditing } from '../dashboard/widgets/WhosEditing'
import { SiteStatusCard } from '../dashboard/widgets/SiteStatusCard'
import { GettingStarted } from '../dashboard/widgets/GettingStarted'
import { TipsDeck } from '../dashboard/widgets/TipsDeck'

export function Dashboard() {
  const { data, git } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [locks, setLocks] = useState<Lock[]>([])

  useEffect(() => {
    let live = true
    void (async () => {
      const loaded = await loadDashboardEntries(data, git, deployedAt)
      if (!live) return
      setRows(loaded)
      setLocks(await loadActiveLocks(data, loaded))
    })()
    return () => { live = false }
  }, [data, git, deployedAt, deploySha])

  const counts = dashboardCounts(rows ?? [])

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Your site at a glance." />
      <div className="page-body dash">
        <CountsTiles posts={counts.posts} pages={counts.pages} drafts={counts.drafts} media={null} />
        <div className="dash-grid">
          <div className="dash-col-main">
            <RecentEdits rows={recentEntries(rows ?? [], 6)} />
            <QuickActions />
            <WhosEditing locks={locks} />
          </div>
          <div className="dash-col-side">
            <SiteStatusCard url={siteUrl()} deployedSha={deploySha} topology="Local" />
            <GettingStarted hasSiteUrl={siteUrl() !== ''} hasPost={counts.posts > 0} hasDeployed={deploySha !== null} />
            <TipsDeck />
          </div>
        </div>
      </div>
    </>
  )
}
