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
  SelectValue,
} from '@/components/ui/select'
import { Pager } from './content-list/Pager'

const PAGE_SIZE = 20
const ALL = '__all__'

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
      { replace: true },
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

  // Load distinct forms for filter dropdown.
  useEffect(() => {
    void submissions.distinctForms().then(setForms)
  }, [submissions, refreshKey])

  // Run the query.
  useEffect(() => {
    let live = true
    void (async () => {
      const filter: Parameters<typeof submissions.listSubmissions>[0] = {
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }
      if (form) filter.formId = form
      if (readParam === 'true') filter.read = true
      if (readParam === 'false') filter.read = false
      if (q) filter.q = q
      const r = await submissions.listSubmissions(filter)
      if (live) {
        setRows(r.rows)
        setTotal(r.total)
      }
    })()
    return () => {
      live = false
    }
  }, [submissions, page, form, readParam, q, refreshKey])

  const refresh = () => setRefreshKey((k) => k + 1)

  const openDetail = async (s: Submission) => {
    setActive(s)
    if (!s.read) {
      await submissions.setRead([s.id], true)
      refresh()
    }
  }

  const toggleRead = async (s: Submission) => {
    await submissions.setRead([s.id], !s.read)
    notify.success(s.read ? 'Marked unread' : 'Marked read')
    refresh()
    // Keep active panel in sync.
    if (active && active.id === s.id) {
      setActive({ ...s, read: !s.read })
    }
  }

  const removeMany = async (ids: string[]) => {
    if (ids.length === 0) return
    await submissions.deleteSubmissions(ids)
    notify.success(`Deleted ${ids.length} submission${ids.length === 1 ? '' : 's'}`)
    setSelected(new Set())
    if (active && ids.includes(active.id)) setActive(null)
    refresh()
  }

  const exportCsv = async () => {
    // Export the full filtered set, not just the current page.
    const filter: Parameters<typeof submissions.listSubmissions>[0] = { limit: 100000 }
    if (form) filter.formId = form
    if (readParam === 'true') filter.read = true
    if (readParam === 'false') filter.read = false
    if (q) filter.q = q
    const all = await submissions.listSubmissions(filter)
    const blob = new Blob([submissionsToCsv(all.rows)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'submissions.csv'
    a.click()
    URL.revokeObjectURL(url)
    notify.success(`Exported ${all.rows.length} submission${all.rows.length === 1 ? '' : 's'}`)
  }

  const pageKeys = (rows ?? []).map((r) => r.id)
  const allSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pageKeys))
  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
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
          <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={total === 0}>
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
          <Select value={form || ALL} onValueChange={(v) => setParam('form', v === ALL ? '' : v)}>
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
          <Select value={readParam || ALL} onValueChange={(v) => setParam('read', v === ALL ? '' : v)}>
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
        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No submissions{form || readParam || q ? ' match your filters' : ' yet'}.
          </p>
        ) : (
          <>
            {/* Bulk action bar */}
            {selected.size > 0 && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <span className="text-sm font-medium">{selected.size} selected</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void submissions.setRead([...selected], true).then(() => {
                      notify.success('Marked read')
                      setSelected(new Set())
                      refresh()
                    })
                  }
                >
                  Mark read
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void submissions.setRead([...selected], false).then(() => {
                      notify.success('Marked unread')
                      setSelected(new Set())
                      refresh()
                    })
                  }
                >
                  Mark unread
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void removeMany([...selected])}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            )}

            {/* Submissions table */}
            <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-muted-foreground">
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
                    <th className="px-3 py-2">Form</th>
                    <th className="px-3 py-2">Received</th>
                    <th className="w-24 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      className={`border-b last:border-0 ${s.read ? '' : 'font-medium'}`}
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
                        {s.fields['email'] ?? s.fields['name'] ?? '(no email)'}
                      </td>
                      <td className="px-3 py-2">{s.formLabel ?? s.formId}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="ghost" onClick={() => void toggleRead(s)}>
                          {s.read ? 'Unread' : 'Read'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {total > 0 && (
                <Pager from={from} to={to} total={total} page={page} onPage={setPage} />
              )}
            </div>
          </>
        )}

        {/* Detail panel */}
        {active && (
          <div className="mt-4 rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">{active.formLabel ?? active.formId}</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void toggleRead(active)}>
                  {active.read ? 'Mark unread' : 'Mark read'}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void removeMany([active.id])}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setActive(null)}>
                  Close
                </Button>
              </div>
            </div>
            <dl className="grid gap-2">
              {Object.entries(active.fields).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[8rem_1fr] gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="whitespace-pre-wrap">{v}</dd>
                </div>
              ))}
              <div className="grid grid-cols-[8rem_1fr] gap-2">
                <dt className="text-muted-foreground">Received</dt>
                <dd>{new Date(active.createdAt).toLocaleString()}</dd>
              </div>
              {active.source?.url && (
                <div className="grid grid-cols-[8rem_1fr] gap-2">
                  <dt className="text-muted-foreground">Page</dt>
                  <dd className="truncate">{active.source.url}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </PageBody>
    </>
  )
}
