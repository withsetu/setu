import { useEffect, useState } from 'react'
import { Rocket, RotateCw } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { formatDuration, relativeTime } from '@/lib/format'
import { useDeploy } from './deploy'
import { DeployOutcomeUnknownError } from './deploy-errors'
import { useCan } from '../auth/actor'
import { useNotify } from '../ui/notify'

/** How often the elapsed readout ticks while a build runs. Sub-second so the
 *  seconds counter never visibly stalls; cheap (one setState on a short string). */
const TICK_MS = 250

/** The deliberate-publish control (#208/#209/#571).
 *
 *  Three jobs beyond "start a build":
 *  1. Confirm first — a deploy is outward and costly, and the owner may have pressed the
 *     button by reflex. Every entry point (here and the command palette) routes through
 *     the same provider-held confirmation, so neither can deploy without asking.
 *  2. Be visibly alive while it runs — the button itself becomes the progress bar
 *     (owner's suggested affordance, #571) with a ticking elapsed readout. The bar is
 *     deliberately INDETERMINATE: the build job reports running/done/failed and nothing
 *     finer, and inventing a percentage would be a lie about progress we can't see.
 *  3. Be honest about saved ≠ live (CLAUDE.md card #7) — committing to Git does not
 *     update the static site; the last-built line and the dialog copy say so.
 *
 *  Server truth via useDeploy(); the API enforces site.deploy — the hiding here is UX.
 */
export function DeployControl() {
  const can = useCan()
  const {
    status,
    loadError,
    rebuild,
    refresh,
    running,
    startedAt,
    confirmOpen,
    requestRebuild,
    closeConfirm
  } = useDeploy()
  const notify = useNotify()
  // The elapsed readout is derived, not stored: the interval only nudges React to
  // re-render, and the value is computed at render time. Storing it would mean a
  // setState in the effect body (cascading render) and a stale first frame.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => tick((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [running])
  const elapsedMs = running && startedAt !== null ? Date.now() - startedAt : 0
  const [retrying, setRetrying] = useState(false)

  if (!can('site.deploy')) return null

  if (status === null) {
    // Loading, or denied (401/403 → loadError stays null): nothing to show. A real failure is
    // shown with a way out — hiding here would take Rebuild away exactly when it is needed (#1158).
    if (loadError === null) return null
    return (
      <>
        <SidebarMenuButton
          onClick={() => {
            setRetrying(true)
            // refresh() reports its own failure through loadError and never rejects
            // (apps/admin/test/deploy.test.tsx, the unreachable-server case).
            void refresh().finally(() => setRetrying(false))
          }}
          disabled={retrying}
          aria-busy={retrying}
          aria-label="Retry loading the deploy status"
          title={loadError}
          tooltip={loadError}
        >
          <RotateCw className={retrying ? 'animate-spin' : undefined} />
          <span>{retrying ? 'Retrying…' : 'Deploy status · Retry'}</span>
        </SidebarMenuButton>
        <p
          className="px-2 pt-1 text-[0.6875rem] leading-tight text-destructive group-data-[collapsible=icon]:hidden"
          role="alert"
        >
          {loadError}
        </p>
      </>
    )
  }

  const pendingCount = status.changedPaths.length
  const deployedAtMs =
    status.deployedAt === null ? null : Date.parse(status.deployedAt)
  const lastBuilt =
    deployedAtMs === null || Number.isNaN(deployedAtMs)
      ? 'Never built — nothing is live yet'
      : `Last built ${relativeTime(deployedAtMs)}`
  // #1158: the recorded deploy can't be diffed against HEAD, so the empty changedPaths means
  // "unknown" — never render it as a count, and never as up to date.
  const lost = status.baselineUnresolvable && status.deployedSha !== null
  // The most recent job failed — a broken build, the deadline, or an api restart that
  // interrupted it (#1157). Shown until a later build replaces it as the latest job.
  const lastFailure =
    !running && status.job?.status === 'failed'
      ? (status.job.error ?? 'The build failed.')
      : null

  const label = running
    ? `Building… ${formatDuration(elapsedMs)}`
    : lost
      ? 'Publish · status unknown'
      : !status.pending && status.deployedSha !== null
        ? `Up to date · ${status.deployedSha.slice(0, 7)}`
        : status.deployedSha === null
          ? 'Publish site'
          : `Publish · ${pendingCount} pending`
  // #1087: the server distinguishes "this topology cannot build" from "something is blocking a
  // build right now" and words the second itself; render its reason rather than the generic line.
  const tooltip = !status.canRebuild
    ? (status.rebuildBlockedReason ??
      'Rebuild is not available in this deployment')
    : running
      ? 'Building the site…'
      : lost
        ? "Can't tell which saved changes are live — rebuild to publish the whole site"
        : status.pending
          ? 'Rebuild the site so saved changes go live'
          : 'Site is up to date with your saved content'

  function start() {
    const startedAtMs = Date.now()
    const took = () => formatDuration(Date.now() - startedAtMs)
    void rebuild()
      .then(() =>
        notify.success(`Site rebuilt in ${took()} — changes are live`)
      )
      .catch((e: unknown) => {
        // Never a success toast on a failed job: name it a failure, keep the
        // server's reason, and re-read status so the button stops lying.
        const why = e instanceof Error ? e.message : String(e)
        notify.error(
          e instanceof DeployOutcomeUnknownError
            ? `Lost track of the rebuild after ${took()}: ${why}. Whether it finished is unknown until the deploy status loads again.`
            : `Rebuild failed after ${took()}: ${why}`
        )
        void refresh()
      })
  }

  return (
    <>
      <SidebarMenuButton
        onClick={() => requestRebuild()}
        disabled={running || !status.canRebuild}
        aria-busy={running}
        aria-label="Publish site"
        // Also a native title: a Radix tooltip never opens on a disabled button, which is
        // exactly when the reason matters most (apps/admin/test/deploy-control.test.tsx).
        title={tooltip}
        tooltip={tooltip}
        className="relative overflow-hidden"
      >
        {running && (
          <span
            aria-hidden
            data-slot="deploy-progress"
            className="pointer-events-none absolute inset-0 bg-primary/10"
          >
            <span className="deploy-progress-sweep absolute inset-y-0 w-1/2 bg-primary/30" />
          </span>
        )}
        <Rocket className="relative" />
        <span className="relative">{label}</span>
      </SidebarMenuButton>
      <p
        className="px-2 pt-1 text-[0.6875rem] leading-tight text-muted-foreground group-data-[collapsible=icon]:hidden"
        role="status"
        aria-live="polite"
      >
        {running
          ? `Building the site… ${formatDuration(elapsedMs)}`
          : lost
            ? `Can't tell what's live — the last deploy (${status.deployedSha?.slice(0, 7) ?? ''}) isn't in your content history`
            : lastBuilt}
      </p>
      {lastFailure !== null && (
        <p className="px-2 pt-1 text-[0.6875rem] leading-tight text-destructive group-data-[collapsible=icon]:hidden">
          Last build failed: {lastFailure}
        </p>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) closeConfirm()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish site?</AlertDialogTitle>
            <AlertDialogDescription>
              {status.deployedSha === null ? (
                // Never deployed. `changedPaths` is EMPTY here for a reason that is not
                // "nothing changed": the server has no deploy baseline to diff against
                // (apps/api/src/deploy.ts returns [] when deploy state is null), so
                // pendingCount is meaningless. Saying "no saved changes are pending"
                // off that zero is an inverted claim — everything is pending. Branch on
                // deployedSha BEFORE pendingCount so the count is only ever read where
                // it means something. Found in owner UAT on a fresh sandbox where 19
                // staged entries were described as none pending (#571).
                <>
                  Nothing has been deployed yet — this build publishes your
                  whole site for the first time. Saving to Git does not publish
                  on its own, so nothing you have saved is live until this build
                  finishes.
                </>
              ) : lost ? (
                // #1158: no usable diff, so no count — say what is actually known.
                <>
                  The last recorded deploy (
                  <span className="font-mono">
                    {status.deployedSha?.slice(0, 7)}
                  </span>
                  ) is no longer in your content history, so Setu can't tell
                  which saved changes are live. This build republishes your
                  whole site from your current content. Saving to Git does not
                  update the live site on its own, so nothing you have saved is
                  guaranteed live until this build finishes.
                </>
              ) : (
                <>
                  This runs a full site build and replaces what is currently
                  live.{' '}
                  {pendingCount > 0
                    ? `${pendingCount} saved ${pendingCount === 1 ? 'change' : 'changes'} will go live.`
                    : 'No saved changes are pending — this rebuilds the live site from your current content.'}{' '}
                  Saving to Git does not update the live site on its own, so
                  nothing you have saved is live until this build finishes.{' '}
                  {lastBuilt}.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={start}>Publish now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
