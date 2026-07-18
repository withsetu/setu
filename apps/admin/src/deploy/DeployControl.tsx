import { useEffect, useState } from 'react'
import { Rocket } from 'lucide-react'
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

  if (!can('site.deploy') || status === null) return null

  const pendingCount = status.changedPaths.length
  const deployedAtMs =
    status.deployedAt === null ? null : Date.parse(status.deployedAt)
  const lastBuilt =
    deployedAtMs === null || Number.isNaN(deployedAtMs)
      ? 'Never built — nothing is live yet'
      : `Last built ${relativeTime(deployedAtMs)}`

  const label = running
    ? `Building… ${formatDuration(elapsedMs)}`
    : !status.pending && status.deployedSha !== null
      ? `Up to date · ${status.deployedSha.slice(0, 7)}`
      : status.deployedSha === null
        ? 'Publish site'
        : `Publish · ${pendingCount} pending`
  const tooltip = !status.canRebuild
    ? 'Rebuild is not available in this deployment'
    : running
      ? 'Building the site…'
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
        notify.error(`Rebuild failed after ${took()}: ${why}`)
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
          : lastBuilt}
      </p>

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
