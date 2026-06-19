import { useDismissed } from '../use-dismissed'

interface Tip { title: string; body: string; pro?: boolean }

const TIPS: Tip[] = [
  { title: 'Press / in the editor', body: 'The slash menu inserts any block — headings, lists, callouts, images.' },
  { title: 'Everything is Git', body: 'Each save is a commit. Your content history lives in your repo.' },
  { title: 'Scheduled publishing', body: 'Queue posts to go live later.', pro: true },
]

export function TipsDeck() {
  const { dismissed, dismiss } = useDismissed('tips')
  if (dismissed) return null
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <h2 className="dash-card-title">Tips</h2>
        <button type="button" className="btn btn-sm" onClick={dismiss} aria-label="Dismiss tips">Dismiss</button>
      </div>
      <ul className="dash-tips">
        {TIPS.map((tip) => (
          <li key={tip.title} className="dash-tip">
            <span className="dash-tip-title">
              {tip.title}
              {tip.pro && <span className="badge badge-accent badge-soft pill-sm">Pro</span>}
            </span>
            <span className="ctable-muted">{tip.body}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
