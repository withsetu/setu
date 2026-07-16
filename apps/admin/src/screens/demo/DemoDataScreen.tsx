/** Demo Data panel (#513, epic #509) — DEV-ONLY admin screen over the
 *  /api/demo control plane: pick a content pack, configure users/posts, watch
 *  live seed progress, and reset at three levels. Absorbs the old floating
 *  "Reset to sample content" button (#492).
 *
 *  Design reference (owner-approved via the epic): composed like the existing
 *  Settings screens — one Card per section, shadcn controls only (Card,
 *  Select, Input, Slider, Switch, Button, Progress, AlertDialog — the
 *  DeleteTagDialog confirm pattern for the destructive resets).
 *
 *  Every import path to this module is gated `import.meta.env.DEV`, so
 *  production builds dead-code-eliminate the whole panel. The server enforces
 *  the same boundary independently (routes absent outside local+dev, and
 *  admin-only via `users.delete`). */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, Download, FlaskConical } from 'lucide-react'
import { PageHeader } from '../../shell/PageHeader'
import { PageBody } from '../../shell/PageBody'
import { useNotify } from '../../ui/notify'
import { resetToSampleContent } from '../../data/reset'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { useDemoApi } from './demo-client'
import type { DemoJob, ResetLevel, SeedRequest } from './demo-client'

const POST_PRESETS = [50, 1000, 10000, 30000] as const
const MAX_POSTS = 30_000
const MAX_USERS_PER_ROLE = 50

const ROLE_FIELDS = [
  { key: 'admin', label: 'Admins', fallback: 1 },
  { key: 'maintainer', label: 'Maintainers', fallback: 1 },
  { key: 'editor', label: 'Editors', fallback: 2 },
  { key: 'author', label: 'Authors', fallback: 5 }
] as const

const PHASE_LABELS: Record<string, string> = {
  starting: 'Starting…',
  users: 'Creating users',
  plan: 'Planning posts',
  categories: 'Registering categories',
  images: 'Downloading images',
  posts: 'Committing posts',
  download: 'Downloading dataset (~115 MiB)',
  extract: 'Extracting dataset'
}

const JOB_NOUNS: Record<DemoJob['kind'], string> = {
  seed: 'Seeding',
  'unseed-generated': 'Removing generated content',
  'reset-sample': 'Resetting to sample content',
  'reset-zero': 'Erasing everything',
  'fetch-dump': 'Downloading dataset'
}

const fmt = (n: number): string => n.toLocaleString('en-US')

/** Phase label + live bar for a running job (shared by Dataset/Seed/Reset). */
function JobProgress({ job }: { job: DemoJob }) {
  const determinate = job.total > 0
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">
          {PHASE_LABELS[job.phase] ?? job.phase}
        </p>
        {determinate && (
          <p className="text-sm tabular-nums text-muted-foreground">
            {fmt(job.done)} / {fmt(job.total)}
          </p>
        )}
      </div>
      <Progress
        value={determinate ? (job.done / job.total) * 100 : null}
        className={determinate ? undefined : 'animate-pulse'}
      />
      {job.imageFailures > 0 && (
        <p className="text-[13px] text-muted-foreground">
          {fmt(job.imageFailures)} image download
          {job.imageFailures === 1 ? '' : 's'} failed so far — counted, not
          fatal; re-running the seed retries them.
        </p>
      )}
      {job.warnings.map((w) => (
        <p key={w} className="text-[13px] text-amber-600 dark:text-amber-400">
          {w}
        </p>
      ))}
    </div>
  )
}

/** Click-to-copy with visible confirmation. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

/** One reset action row + its explicit-consequences confirm dialog. */
function ResetRow({
  title,
  description,
  buttonLabel,
  dialogTitle,
  dialogBody,
  destructive,
  disabled,
  onConfirm
}: {
  title: string
  description: string
  buttonLabel: string
  dialogTitle: string
  dialogBody: string
  destructive?: boolean
  disabled: boolean
  onConfirm: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {description}
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'outline'}
            disabled={disabled}
          >
            {buttonLabel}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{dialogBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              className={
                destructive
                  ? 'bg-destructive text-white hover:bg-destructive/90'
                  : undefined
              }
            >
              {buttonLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SectionCard({
  title,
  children
}: {
  title: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  )
}

export function DemoDataScreen() {
  // Read inside the component (not module scope) so tests can stub the env.
  const apiBase = import.meta.env.VITE_SETU_API
  return (
    <>
      <PageHeader
        title="Demo Data"
        subtitle="Fill this dev site with realistic demo content — users in every role, posts at scale, real images — then reset at three levels. Development only: this screen and its API do not exist in production builds."
      />
      <PageBody className="grid max-w-[880px] gap-6">
        {apiBase ? (
          <DemoDataPanel apiBase={apiBase} />
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Demo data needs the dev API. Launch the stack with{' '}
              <code className="rounded bg-secondary px-1.5 py-0.5">
                pnpm dev
              </code>{' '}
              so{' '}
              <code className="rounded bg-secondary px-1.5 py-0.5">
                VITE_SETU_API
              </code>{' '}
              is set, then reload.
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  )
}

function DemoDataPanel({ apiBase }: { apiBase: string }) {
  const notify = useNotify()
  const { status, loadError, startSeed, startUnseed, startFetchDump, cancel } =
    useDemoApi(apiBase)

  // -- form state -----------------------------------------------------------
  const [users, setUsers] = useState<
    Record<(typeof ROLE_FIELDS)[number]['key'], string>
  >({
    admin: '1',
    maintainer: '1',
    editor: '2',
    author: '5'
  })
  const [posts, setPosts] = useState('1000')
  const [draftPct, setDraftPct] = useState(10)
  const [relaxText, setRelaxText] = useState(false)
  const [limitImages, setLimitImages] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // -- job transition side effects (notify once per terminal transition) -----
  const job = status?.job ?? null
  const lastSeen = useRef<string>('')
  const [passwordsFor, setPasswordsFor] = useState<string | null>(null)
  useEffect(() => {
    if (!job) return
    const key = `${job.id}:${job.status}`
    if (lastSeen.current === key) return
    const previous = lastSeen.current
    lastSeen.current = key
    if (job.status === 'running') return
    // Only announce a transition we watched happen (not a stale terminal job
    // found on first load — `previous` empty means this is the initial fetch).
    const watched = previous === `${job.id}:running`
    if (!watched) return
    const noun = JOB_NOUNS[job.kind]
    if (job.status === 'failed') {
      notify.error(`${noun} failed: ${job.error ?? 'unknown error'}`)
      return
    }
    if (job.status === 'cancelled') {
      notify.info(`${noun} cancelled.`)
      return
    }
    // done
    if (job.kind === 'seed' && job.seedSummary) {
      const s = job.seedSummary
      notify.success(
        `Seeded ${fmt(s.posts)} posts and ${fmt(s.images)} images in ${(s.durationMs / 1000).toFixed(1)}s` +
          (s.imageFailures > 0
            ? ` (${fmt(s.imageFailures)} image downloads failed)`
            : '')
      )
      setPasswordsFor(job.id)
      return
    }
    if (job.kind === 'unseed-generated' && job.removeSummary) {
      const r = job.removeSummary
      notify.success(
        `Removed ${fmt(r.posts)} posts, ${fmt(r.media)} media items, ${fmt(r.users)} demo users, ${fmt(r.categories)} categories.`
      )
      return
    }
    if (job.kind === 'fetch-dump') {
      notify.success('Demo dataset downloaded and extracted.')
      return
    }
    // reset-sample / reset-zero: the server content changed wholesale — clear
    // the browser-side stores (drafts/index caches) and reload into the fresh
    // state, exactly what the old floating dev-reset button did (#492).
    void resetToSampleContent()
  }, [job, notify])

  const running = job?.status === 'running'
  const dataset = status?.dataset ?? null

  // -- seed submit ------------------------------------------------------------
  const parseCount = (raw: string, max: number): number | null => {
    if (!/^\d+$/.test(raw.trim())) return null
    const n = Number.parseInt(raw, 10)
    return n > max ? null : n
  }

  const submitSeed = () => {
    const next: Record<string, string> = {}
    const postCount = parseCount(posts, MAX_POSTS)
    if (postCount === null)
      next['posts'] = `Enter a whole number up to ${fmt(MAX_POSTS)}.`
    const roleCounts = {} as SeedRequest['users']
    for (const field of ROLE_FIELDS) {
      const n = parseCount(users[field.key], MAX_USERS_PER_ROLE)
      if (n === null) next[field.key] = `0–${MAX_USERS_PER_ROLE}.`
      else roleCounts[field.key] = n
    }
    let limit: number | undefined
    if (limitImages.trim() !== '') {
      const n = parseCount(limitImages, MAX_POSTS)
      if (n === null)
        next['limitImages'] =
          `Enter a whole number up to ${fmt(MAX_POSTS)}, or leave empty.`
      else limit = n
    }
    setErrors(next)
    if (Object.keys(next).length > 0 || postCount === null) return
    setPasswordsFor(null)
    const body: SeedRequest = {
      posts: postCount,
      users: roleCounts,
      draftFraction: draftPct / 100,
      relaxText,
      ...(limit !== undefined ? { limitImages: limit } : {})
    }
    startSeed(body).catch((e: unknown) =>
      notify.error(e instanceof Error ? e.message : String(e))
    )
  }

  const runUnseed = (level: ResetLevel) => {
    startUnseed(level).catch((e: unknown) =>
      notify.error(e instanceof Error ? e.message : String(e))
    )
  }

  if (loadError !== null && status === null) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Could not reach the demo-data API: {loadError}
        </CardContent>
      </Card>
    )
  }
  if (status === null) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    )
  }

  const seedJobRunning = running && job?.kind === 'seed'
  const dumpJobRunning = running && job?.kind === 'fetch-dump'
  const resetJobRunning =
    running && job !== null && !seedJobRunning && !dumpJobRunning
  const doneSeed =
    job?.kind === 'seed' && job.status === 'done' && job.seedSummary
      ? job.seedSummary
      : null
  const showPasswords =
    doneSeed !== null &&
    passwordsFor !== null &&
    job !== null &&
    passwordsFor === job.id

  return (
    <>
      {/* ------------------------------------------------ Dataset */}
      <SectionCard title="Dataset">
        <div className="grid max-w-md gap-2">
          <Label htmlFor="demo-pack">Content pack</Label>
          <Select value="aic">
            <SelectTrigger id="demo-pack" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aic">Art Institute of Chicago</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[13px] text-muted-foreground">
            Public-domain artworks (CC0 data, keyless API) — titles, long-form
            descriptions, dates, categories, tags, and images in mixed sizes.
          </p>
        </div>
        {dumpJobRunning && job ? (
          <JobProgress job={job} />
        ) : dataset?.present ? (
          <p className="text-sm text-muted-foreground">
            {dataset.kind === 'dump'
              ? 'Dataset ready — full data dump found locally.'
              : 'Sample dataset found (a bounded slice). Fine for small seeds; download the full dump for large ones.'}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm text-muted-foreground">
              The dataset is not downloaded yet — seeding needs it locally.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={running}
              onClick={() => {
                startFetchDump().catch((e: unknown) =>
                  notify.error(e instanceof Error ? e.message : String(e))
                )
              }}
            >
              <Download className="size-4" />
              Download dataset (~115 MiB)
            </Button>
          </div>
        )}
      </SectionCard>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!running && dataset?.present) submitSeed()
        }}
      >
        <div className="grid gap-6">
          {/* ------------------------------------------------ Users */}
          <SectionCard title="Users">
            <p className="text-sm text-muted-foreground">
              Demo accounts per role. Passwords are generated and shown once
              after seeding; posts are spread across these authors.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {ROLE_FIELDS.map((field) => (
                <div key={field.key} className="grid gap-2">
                  <Label htmlFor={`demo-users-${field.key}`}>
                    {field.label}
                  </Label>
                  <Input
                    id={`demo-users-${field.key}`}
                    inputMode="numeric"
                    value={users[field.key]}
                    onChange={(e) =>
                      setUsers((u) => ({ ...u, [field.key]: e.target.value }))
                    }
                    aria-invalid={errors[field.key] !== undefined}
                  />
                  {errors[field.key] && (
                    <p className="text-[13px] text-destructive">
                      {errors[field.key]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* ------------------------------------------------ Content */}
          <SectionCard title="Content">
            <div className="grid gap-2">
              <Label htmlFor="demo-posts">Posts</Label>
              <div className="flex flex-wrap items-center gap-2">
                {POST_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={posts === String(preset) ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={posts === String(preset)}
                    onClick={() => setPosts(String(preset))}
                  >
                    {fmt(preset)}
                  </Button>
                ))}
                <Input
                  id="demo-posts"
                  inputMode="numeric"
                  className="w-28"
                  value={posts}
                  onChange={(e) => setPosts(e.target.value)}
                  aria-invalid={errors['posts'] !== undefined}
                  aria-label="Custom post count"
                />
              </div>
              {errors['posts'] && (
                <p className="text-[13px] text-destructive">
                  {errors['posts']}
                </p>
              )}
            </div>

            <div className="grid max-w-md gap-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="demo-draft-fraction">Drafts</Label>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {draftPct}%
                </span>
              </div>
              <Slider
                id="demo-draft-fraction"
                aria-label="Fraction of posts seeded as drafts"
                min={0}
                max={100}
                step={5}
                value={[draftPct]}
                onValueChange={([v]) => setDraftPct(v ?? 0)}
              />
              <p className="text-[13px] text-muted-foreground">
                This fraction of posts is seeded unpublished (drafts).
              </p>
            </div>

            <div className="flex items-start justify-between gap-6">
              <div className="grid gap-1">
                <Label htmlFor="demo-relax-text">Relax text quality</Label>
                <p className="max-w-[52ch] text-[13px] text-muted-foreground">
                  Also admit artworks with only a short source description,
                  giving them clearly labeled placeholder bodies. Honest
                  trade-off: strict quality tops out around ~6,400 posts — large
                  counts (10k+) need this on.
                </p>
              </div>
              <Switch
                id="demo-relax-text"
                checked={relaxText}
                onCheckedChange={setRelaxText}
              />
            </div>

            <div className="grid max-w-md gap-2">
              <Label htmlFor="demo-limit-images">
                Limit images to the first…
              </Label>
              <Input
                id="demo-limit-images"
                inputMode="numeric"
                className="w-40"
                placeholder="All posts"
                value={limitImages}
                onChange={(e) => setLimitImages(e.target.value)}
                aria-invalid={errors['limitImages'] !== undefined}
              />
              {errors['limitImages'] ? (
                <p className="text-[13px] text-destructive">
                  {errors['limitImages']}
                </p>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  Images are the slow part of big seeds — leave empty to give
                  every post a featured image, or cap the downloads here.
                </p>
              )}
            </div>
          </SectionCard>

          {/* ------------------------------------------------ Seed */}
          <SectionCard title="Seed">
            {seedJobRunning && job ? (
              <>
                <JobProgress job={job} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void cancel()}
                >
                  Cancel
                </Button>
                <p className="text-[13px] text-muted-foreground">
                  Cancelling keeps completed work — re-running the same seed
                  resumes from its checkpoint.
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-4">
                  <Button type="submit" disabled={running || !dataset?.present}>
                    <FlaskConical className="size-4" />
                    Seed demo content
                  </Button>
                  {!dataset?.present && (
                    <p className="text-[13px] text-muted-foreground">
                      Download the dataset first.
                    </p>
                  )}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  Seeding commits content to the sandbox repo — the static site
                  still needs its own rebuild to show it (saved ≠ live).
                  Re-running with the same options resumes and retries failed
                  images instead of duplicating.
                </p>
              </>
            )}

            {showPasswords && doneSeed && (
              <div
                role="region"
                aria-label="Demo user credentials"
                className="rounded-lg border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-950/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold">
                      Demo user credentials — shown once
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      Dev-only passwords, never stored in plain text and not
                      shown again. Copy what you need now.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPasswordsFor(null)}
                  >
                    Dismiss
                  </Button>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {doneSeed.users.map((user) => (
                    <li
                      key={user.email}
                      className="flex items-center gap-2 font-mono text-[13px]"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {user.email}
                        <span className="ml-2 font-sans text-muted-foreground">
                          {user.role}
                        </span>
                      </span>
                      {user.password === null ? (
                        <span className="font-sans text-muted-foreground">
                          password unchanged (already existed)
                        </span>
                      ) : (
                        <>
                          <span>{user.password}</span>
                          <CopyButton
                            value={user.password}
                            label={`Copy password for ${user.email}`}
                          />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>
        </div>
      </form>

      {/* ------------------------------------------------ Reset */}
      <SectionCard title="Reset">
        {resetJobRunning && job ? (
          <>
            <p className="text-sm font-medium">{JOB_NOUNS[job.kind]}…</p>
            <JobProgress job={job} />
            {job.cancellable && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void cancel()}
              >
                Cancel
              </Button>
            )}
          </>
        ) : (
          <div className="divide-y divide-border">
            <ResetRow
              title="Remove generated content"
              description="Deletes only what seeding created; hand-made content stays."
              buttonLabel="Remove generated"
              dialogTitle="Remove generated content?"
              dialogBody="Deletes exactly what seeding created: seeded posts, their downloaded images, demo user accounts, and categories nothing else uses. Survives: hand-made content, your uploads, your account, and site settings."
              disabled={running}
              onConfirm={() => runUnseed('generated')}
            />
            <ResetRow
              title="Reset to sample content"
              description="Back to the shipped sample site — today's dev default."
              buttonLabel="Reset to sample"
              dialogTitle="Reset to sample content?"
              dialogBody="Replaces ALL content and taxonomy with the shipped samples and removes everything seeding generated (posts, images, demo users). Survives: your account, site settings, and hand-uploaded media. Hand-made content does NOT survive. The app reloads when this finishes."
              disabled={running}
              onConfirm={() => runUnseed('sample')}
            />
            <ResetRow
              title="Erase everything (absolute zero)"
              description="An empty site: no posts, no pages, no taxonomy."
              buttonLabel="Erase everything"
              dialogTitle="Erase everything?"
              dialogBody="Empties the site: every post and page, all categories and tags, and everything seeding generated (including demo users). Survives: your account (you stay signed in), site settings, and hand-uploaded media. The app reloads when this finishes."
              destructive
              disabled={running}
              onConfirm={() => runUnseed('zero')}
            />
          </div>
        )}
      </SectionCard>
    </>
  )
}
