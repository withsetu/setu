import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Submission, FormSummary } from '@setu/core'
import { submissionsToCsv } from '@setu/core'
import { useServices } from '../data/store'
import { useNotify } from '../ui/notify'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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
import { Pager } from './content-list/Pager'

const PAGE_SIZE = 20
const ALL = '__all__'

// Display order for the detail view — subject sits above message regardless of
// the order fields were stored in. Unknown fields follow, in their stored order.
const FIELD_ORDER = ['name', 'email', 'subject', 'message']
const labelOf = (k: string) => k.charAt(0).toUpperCase() + k.slice(1)
const orderedFields = (fields: Record<string, string>): [string, string][] => {
  const known = FIELD_ORDER.filter((k) => k in fields)
  const rest = Object.keys(fields).filter((k) => !FIELD_ORDER.includes(k))
  return [...known, ...rest].map((k) => [k, fields[k] ?? ''])
}
// The page a submission was made from — the relevant column once multiple forms
// can live on different pages. Shows the path; full URL on hover.
const pageOf = (s: Submission): string => {
  const url = s.source?.url
  if (!url) return '—'
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

export function FormsInbox() {
  const { submissions } = useServices()
  const notify = useNotify()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Submission[] | null>(null)
  const [total, setTotal] = useState(0)
  const [forms, setForms] = useState<FormSummary[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<Submission | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [listFailed, setListFailed] = useState(false)

  const form = params.get('form') ?? ''
  const readParam = params.get('read') ?? '' // '', 'true', 'false'
  const q = params.get('q') ?? ''

  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true }
    )

  // Debounced search: local input → URL `q`.
  const [search, setSearch] = useState(q)
  useEffect(() => {
    setSearch(q)
  }, [q])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== q) setParam('q', search)
    }, 200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Reset to page 0 + clear selection when filters change.
  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [form, readParam, q])

  // Load distinct forms for the filter dropdown. Auxiliary to the list query below: on failure
  // the filter just shows no options, and the list effect's own error state + toast already
  // surfaces the outage (both share `refreshKey`, so Try again recovers them together) — so this
  // logs rather than firing a second toast for the same root cause.
  useEffect(() => {
    void submissions
      .distinctForms()
      .then(setForms)
      .catch((err: unknown) => {
        console.error('[forms] loading the forms filter failed', err)
      })
  }, [submissions, refreshKey])

  // Run the query.
  useEffect(() => {
    let live = true
    void (async () => {
      const filter: Parameters<typeof submissions.listSubmissions>[0] = {
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE
      }
      if (form) filter.formId = form
      if (readParam === 'true') filter.read = true
      if (readParam === 'false') filter.read = false
      if (q) filter.q = q
      try {
        const r = await submissions.listSubmissions(filter)
        if (!live) return
        setRows(r.rows)
        setTotal(r.total)
        setListFailed(false)
      } catch (err) {
        // `rows` is only ever set on success, so an escaping rejection used to park the inbox on
        // "Loading…" forever (#835). Show a retryable error in its place instead.
        if (!live) return
        console.error('[forms] loading submissions failed', err)
        setListFailed(true)
        notify.error(
          "Couldn't load submissions. Check your connection and try again."
        )
      }
    })()
    return () => {
      live = false
    }
  }, [submissions, page, form, readParam, q, refreshKey, notify])

  const refresh = () => setRefreshKey((k) => k + 1)

  const openDetail = async (s: Submission) => {
    setActive(s)
    if (!s.read) {
      try {
        await submissions.setRead([s.id], true)
        setActive((a) => (a && a.id === s.id ? { ...a, read: true } : a))
        refresh()
      } catch (e) {
        notify.error(e instanceof Error ? e.message : String(e))
      }
    }
  }

  const toggleRead = async (s: Submission) => {
    try {
      await submissions.setRead([s.id], !s.read)
      notify.success(s.read ? 'Marked unread' : 'Marked read')
      refresh()
      // Keep active panel in sync.
      setActive((a) => (a && a.id === s.id ? { ...a, read: !s.read } : a))
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
  }

  // The two bulk mark-read/unread buttons share this; each used to be an inline
  // `setRead(...).then(...)` chain with no `.catch`, reporting nothing on failure (#837).
  const markSelected = async (read: boolean) => {
    const selectedIds = new Set(selected)
    try {
      await submissions.setRead([...selectedIds], read)
      notify.success(read ? 'Marked read' : 'Marked unread')
      setActive((a) => (a && selectedIds.has(a.id) ? { ...a, read } : a))
      setSelected(new Set())
      refresh()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
  }

  const removeMany = async (ids: string[]) => {
    if (ids.length === 0) return
    try {
      await submissions.deleteSubmissions(ids)
      notify.success(
        `Deleted ${ids.length} submission${ids.length === 1 ? '' : 's'}`
      )
      setSelected(new Set())
      if (active && ids.includes(active.id)) setActive(null)
      refresh()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
  }

  const exportCsv = async () => {
    // Export the full filtered set, not just the current page.
    const filter: Parameters<typeof submissions.listSubmissions>[0] = {
      limit: 100000
    }
    if (form) filter.formId = form
    if (readParam === 'true') filter.read = true
    if (readParam === 'false') filter.read = false
    if (q) filter.q = q
    try {
      const all = await submissions.listSubmissions(filter)
      const blob = new Blob([submissionsToCsv(all.rows)], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'submissions.csv'
      a.click()
      URL.revokeObjectURL(url)
      notify.success(
        `Exported ${all.rows.length} submission${all.rows.length === 1 ? '' : 's'}`
      )
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
  }

  const pageKeys = (rows ?? []).map((r) => r.id)
  const allSelected =
    pageKeys.length > 0 && pageKeys.every((k) => selected.has(k))
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(pageKeys))
  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <>
      <PageHeader
        title="Forms"
        count={rows !== null ? total : undefined}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportCsv()}
            disabled={total === 0}
          >
            Export CSV
          </Button>
        }
      />
      <PageBody>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Input
            className="min-w-48 flex-1"
            placeholder="Search submissions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={form || ALL}
            onValueChange={(v) => setParam('form', v === ALL ? '' : v)}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder="All forms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All forms</SelectItem>
              {forms.map((f) => (
                <SelectItem key={f.formId} value={f.formId}>
                  {(f.formLabel ?? f.formId) + ` (${f.count})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={readParam || ALL}
            onValueChange={(v) => setParam('read', v === ALL ? '' : v)}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              <SelectItem value="false">Unread</SelectItem>
              <SelectItem value="true">Read</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Content */}
        {rows === null && listFailed ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-8">
            <p className="text-sm text-muted-foreground">
              Couldn't load submissions. Check your connection and try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setListFailed(false)
                refresh()
              }}
            >
              Try again
            </Button>
          </div>
        ) : rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No submissions
            {form || readParam || q ? ' match your filters' : ' yet'}.
          </p>
        ) : (
          <>
            {/* Bulk action bar */}
            {selected.size > 0 && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <span className="text-sm font-medium">
                  {selected.size} selected
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void markSelected(true)}
                >
                  Mark read
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void markSelected(false)}
                >
                  Mark unread
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setPendingDelete([...selected])}
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
              </div>
            )}

            {/* Submissions table */}
            <div className="overflow-hidden rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select page"
                      />
                    </th>
                    <th className="px-3 py-2">From</th>
                    <th className="px-3 py-2">Page</th>
                    <th className="px-3 py-2">Received</th>
                    <th className="w-24 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      className={`border-b border-border/40 last:border-0 ${s.read ? '' : 'font-medium'}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={() => toggleRow(s.id)}
                          aria-label="Select submission"
                        />
                      </td>
                      <td
                        className="cursor-pointer px-3 py-2"
                        onClick={() => void openDetail(s)}
                      >
                        {!s.read && (
                          <Badge variant="secondary" className="mr-2">
                            New
                          </Badge>
                        )}
                        {/* #554: visitor-typed values — cap + truncate so a long one can't
                            stretch the table; the full value lives in the detail dialog. */}
                        <span
                          title={
                            s.fields['email'] ?? s.fields['name'] ?? undefined
                          }
                          className="inline-block max-w-72 truncate align-bottom"
                        >
                          {s.fields['email'] ??
                            s.fields['name'] ??
                            '(no email)'}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 text-muted-foreground"
                        title={s.source?.url ?? undefined}
                      >
                        <span className="inline-block max-w-64 truncate align-bottom">
                          {pageOf(s)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void toggleRead(s)}
                        >
                          {s.read ? 'Unread' : 'Read'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {total > 0 && (
                <Pager
                  from={from}
                  to={to}
                  total={total}
                  page={page}
                  onPage={setPage}
                />
              )}
            </div>
          </>
        )}

        {/* Detail modal — opens centered, body scrolls; works on small screens
            without scrolling the table away. */}
        <Dialog
          open={active !== null}
          onOpenChange={(open) => {
            if (!open) setActive(null)
          }}
        >
          {active && (
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{active.formLabel ?? active.formId}</DialogTitle>
                <DialogDescription>
                  {new Date(active.createdAt).toLocaleString()}
                  {active.source?.url ? ` · ${pageOf(active)}` : ''}
                </DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3">
                {orderedFields(active.fields).map(([k, v]) => (
                  <div key={k} className="grid gap-1">
                    <dt className="text-sm font-semibold text-foreground">
                      {labelOf(k)}
                    </dt>
                    <dd className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {v}
                    </dd>
                  </div>
                ))}
                {active.source?.url && (
                  <div className="grid gap-1">
                    <dt className="text-sm font-semibold text-foreground">
                      Page
                    </dt>
                    <dd className="break-all text-sm">
                      <a
                        href={active.source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {active.source.url}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void toggleRead(active)}
                >
                  {active.read ? 'Mark unread' : 'Mark read'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setPendingDelete([active.id])}
                >
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          )}
        </Dialog>

        {/* Delete confirmation — guards both single (modal) and bulk delete. */}
        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {pendingDelete?.length ?? 0} submission
                {(pendingDelete?.length ?? 0) === 1 ? '' : 's'}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes{' '}
                {(pendingDelete?.length ?? 0) === 1
                  ? 'this submission'
                  : 'these submissions'}
                . This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const ids = pendingDelete ?? []
                  setPendingDelete(null)
                  void removeMany(ids)
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageBody>
    </>
  )
}
