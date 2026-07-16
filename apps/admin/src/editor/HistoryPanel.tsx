import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-fetch'
import { relativeTime } from '@/lib/format'
import { useNotify } from '../ui/notify'
import { diffMdoc } from './history-diff'

/** One revision row from `GET /api/history` — mirrors core's GitLogEntry. */
export interface RevisionEntry {
  sha: string
  author: string
  email: string
  date: string
  subject: string
}

/** The server caps `limit` at 50 (history-api.ts's listQuerySchema) — request
 *  full pages and page onward from there. */
const PAGE_SIZE = 50

export interface HistoryPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The entry's repo path — `content/<collection>/<locale>/<slug>.mdoc`. */
  path: string
  apiBase: string
  /** Set when THIS actor can't restore THIS entry regardless of revision
   *  (view-only role on a live post, or the entry is locked): the honest UI
   *  for the rule the server enforces via writeActionForChanges — restore
   *  renders disabled with this reason instead of hiding (card #5's "surface
   *  the denial" posture). */
  restoreDisabledReason?: string
  /** Called after a successful restore commit with the new commit sha — the
   *  editor reloads the restored content. */
  onRestored: (sha: string) => void | Promise<void>
}

/** WordPress-revisions as a Setu editor side panel (#466 design comment):
 *  revision list (author, relative date, subject; HEAD pinned first as
 *  "Current"), a field-row + word-level diff of the selected revision against
 *  the current one, and one-click restore behind a confirm dialog.
 *
 *  The diff compares COMMITTED revisions: "current" is the content at HEAD
 *  (the list's first entry), fetched through the same `/api/history/file`
 *  route as the selected revision — not the live editor buffer. That matches
 *  the list labeling ("Current" = HEAD) and WordPress semantics, and avoids
 *  serializing unsaved keystrokes into a comparison the revision list doesn't
 *  show. */
export function HistoryPanel({
  open,
  onOpenChange,
  path,
  apiBase,
  restoreDisabledReason,
  onRestored
}: HistoryPanelProps) {
  const notify = useNotify()

  const [entries, setEntries] = useState<RevisionEntry[] | null>(null)
  const [listError, setListError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, string>>({})
  const [fileError, setFileError] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const loadPage = useCallback(
    async (offset: number): Promise<RevisionEntry[]> => {
      const res = await apiFetch(
        `${apiBase}/api/history?path=${encodeURIComponent(path)}&limit=${PAGE_SIZE}&offset=${offset}`
      )
      if (!res.ok) throw new Error(`history list failed: ${res.status}`)
      const data = (await res.json()) as { entries: RevisionEntry[] }
      return data.entries
    },
    [apiBase, path]
  )

  // Fresh load on every open — the list is cheap (admin-volume) and a publish
  // since the last open must show up.
  useEffect(() => {
    if (!open) return
    let live = true
    setEntries(null)
    setListError(false)
    setSelected(null)
    setFiles({})
    setFileError(false)
    void (async () => {
      try {
        const page = await loadPage(0)
        if (!live) return
        setEntries(page)
        setHasMore(page.length === PAGE_SIZE)
        // Preselect the most recent PREVIOUS revision so the panel opens
        // showing a meaningful diff instead of a blank pane.
        if (page.length > 1) setSelected(page[1]!.sha)
      } catch {
        if (live) setListError(true)
      }
    })()
    return () => {
      live = false
    }
  }, [open, loadPage])

  const loadMore = async () => {
    if (!entries) return
    setLoadingMore(true)
    try {
      const page = await loadPage(entries.length)
      setEntries([...entries, ...page])
      setHasMore(page.length === PAGE_SIZE)
    } catch {
      notify.error('Could not load more revisions')
    } finally {
      setLoadingMore(false)
    }
  }

  // Fetch the file content for the current (HEAD) and selected revisions —
  // memoized in `files`, so re-selecting a revision never refetches.
  const currentSha = entries?.[0]?.sha ?? null
  useEffect(() => {
    if (!open) return
    const want = [currentSha, selected].filter(
      (s): s is string => s !== null && !(s in files)
    )
    if (want.length === 0) return
    let live = true
    void Promise.all(
      [...new Set(want)].map(async (sha) => {
        const res = await apiFetch(
          `${apiBase}/api/history/file?sha=${sha}&path=${encodeURIComponent(path)}`
        )
        if (!res.ok) throw new Error(`history file failed: ${res.status}`)
        const data = (await res.json()) as { content: string }
        return [sha, data.content] as const
      })
    )
      .then((pairs) => {
        if (live)
          setFiles((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
      })
      .catch(() => {
        if (live) setFileError(true)
      })
    return () => {
      live = false
    }
  }, [open, currentSha, selected, files, apiBase, path])

  const isCurrent = selected !== null && selected === currentSha
  const diff = useMemo(() => {
    if (!selected || !currentSha || isCurrent) return null
    const oldContent = files[selected]
    const newContent = files[currentSha]
    if (oldContent === undefined || newContent === undefined) return null
    return diffMdoc(oldContent, newContent)
  }, [selected, currentSha, isCurrent, files])

  const restoreBlockedReason =
    restoreDisabledReason ??
    (selected === null
      ? 'Select a revision to restore'
      : isCurrent
        ? 'This is already the current revision'
        : undefined)

  const doRestore = async () => {
    if (!selected) return
    setRestoring(true)
    try {
      const res = await apiFetch(`${apiBase}/api/history/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, sha: selected })
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        notify.error(
          res.status === 403
            ? "You don't have permission to restore this revision"
            : (body?.error ?? 'Restore failed')
        )
        return
      }
      const { sha } = (await res.json()) as { sha: string }
      notify.success('Restored · ' + sha.slice(0, 7))
      setConfirmOpen(false)
      onOpenChange(false)
      await onRestored(sha)
    } catch {
      notify.error('Restore failed')
    } finally {
      setRestoring(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* Accessible name comes from SheetTitle via Radix's aria-labelledby
            (which would override any aria-label here anyway). */}
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b p-4">
            <SheetTitle>History</SheetTitle>
            <SheetDescription>
              Every committed revision of this entry. Restoring never rewrites
              history — it adds a new commit.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {entries === null && !listError && (
              <div className="flex flex-col gap-3 p-4" aria-hidden="true">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}
            {listError && (
              <p role="alert" className="p-4 text-sm text-destructive">
                Could not load revision history.
              </p>
            )}
            {entries !== null && (
              <>
                <ul aria-label="Revisions" className="flex flex-col gap-1 p-3">
                  {entries.map((e, i) => (
                    <li key={e.sha}>
                      <button
                        type="button"
                        aria-pressed={selected === e.sha}
                        onClick={() => setSelected(e.sha)}
                        className={cn(
                          'w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                          selected === e.sha && 'bg-accent'
                        )}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {e.author}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {i === 0 && (
                              <Badge variant="secondary">Current</Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {relativeTime(Date.parse(e.date))}
                            </span>
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {e.subject}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {hasMore && (
                  <div className="px-3 pb-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      disabled={loadingMore}
                      onClick={() => void loadMore()}
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                )}
                {entries.length <= 1 && (
                  <p className="px-4 pb-4 text-sm text-muted-foreground">
                    Only one revision so far — earlier versions will appear here
                    after the next publish or draft save.
                  </p>
                )}

                {entries.length > 1 && (
                  <section aria-label="Changes" className="border-t p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {isCurrent
                        ? 'Current revision'
                        : 'Changes since this revision'}
                    </h3>
                    {isCurrent && (
                      <p className="text-sm text-muted-foreground">
                        This is the current revision — select an earlier one to
                        compare.
                      </p>
                    )}
                    {!isCurrent && fileError && (
                      <p role="alert" className="text-sm text-destructive">
                        Could not load this revision&apos;s content.
                      </p>
                    )}
                    {!isCurrent && !fileError && selected && diff === null && (
                      <div className="flex flex-col gap-2" aria-hidden="true">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-2/3" />
                      </div>
                    )}
                    {diff?.identical && (
                      <p className="text-sm text-muted-foreground">
                        No differences from the current revision.
                      </p>
                    )}
                    {diff && !diff.identical && (
                      <div className="flex flex-col gap-4">
                        {diff.fields.length > 0 && (
                          <dl className="flex flex-col gap-2.5">
                            {diff.fields.map((f) => (
                              <div key={f.key}>
                                <dt className="text-xs font-medium text-muted-foreground">
                                  {f.key}
                                </dt>
                                <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                                  {f.from !== null && (
                                    <del className="rounded-xs bg-destructive/15 px-1 text-destructive">
                                      {f.from}
                                    </del>
                                  )}
                                  {f.from !== null && f.to !== null && (
                                    <span
                                      aria-hidden="true"
                                      className="text-muted-foreground"
                                    >
                                      →
                                    </span>
                                  )}
                                  {f.to !== null && (
                                    <ins className="rounded-xs bg-success/15 px-1 text-success no-underline">
                                      {f.to}
                                    </ins>
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {diff.body && (
                          <div className="whitespace-pre-wrap text-sm leading-relaxed">
                            {diff.body.map((seg, i) =>
                              seg.added ? (
                                <ins
                                  key={i}
                                  className="rounded-xs bg-success/15 text-success no-underline"
                                >
                                  {seg.value}
                                </ins>
                              ) : seg.removed ? (
                                <del
                                  key={i}
                                  className="rounded-xs bg-destructive/15 text-destructive"
                                >
                                  {seg.value}
                                </del>
                              ) : (
                                <span key={i}>{seg.value}</span>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </div>

          {entries !== null && entries.length > 1 && (
            <div className="border-t p-4">
              <Button
                className="w-full"
                disabled={restoreBlockedReason !== undefined || restoring}
                onClick={() => setConfirmOpen(true)}
              >
                Restore this revision
              </Button>
              {restoreBlockedReason && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {restoreBlockedReason}
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this revision?</AlertDialogTitle>
            <AlertDialogDescription>
              Restores this revision as a new commit — history is never
              rewritten, and the current version stays in the timeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={(e) => {
                e.preventDefault()
                void doRestore()
              }}
            >
              {restoring ? 'Restoring…' : 'Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
