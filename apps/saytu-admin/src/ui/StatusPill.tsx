type Tone = 'neutral' | 'amber' | 'green' | 'blue' | 'red' | 'accent'

const STATUS_TONE: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  published: { tone: 'green', label: 'Published' },
  staged: { tone: 'amber', label: 'Staged' },
  deployed: { tone: 'blue', label: 'Deployed' },
  building: { tone: 'blue', label: 'Building' },
  failed: { tone: 'red', label: 'Failed' },
  scheduled: { tone: 'accent', label: 'Scheduled' },
  live: { tone: 'green', label: 'Live' },
  unpublished: { tone: 'neutral', label: 'Unpublished' },
}

export function StatusPill({ status }: { status: string }) {
  const known = STATUS_TONE[status.toLowerCase()]
  const tone: Tone = known ? known.tone : 'neutral'
  const label = known ? known.label : status
  return (
    <span className={`badge badge-${tone} badge-soft pill-sm`}>
      <span className="badge-dot" />
      {label}
    </span>
  )
}
