import { useDismissed } from '../use-dismissed'

function Item({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="dash-check-item">
      <span role="checkbox" aria-checked={done} aria-label={label} className={`dash-check ${done ? 'is-done' : ''}`} />
      <span className={done ? 'dash-check-done' : ''}>{label}</span>
    </li>
  )
}

export function GettingStarted({
  hasSiteUrl, hasPost, hasDeployed,
}: { hasSiteUrl: boolean; hasPost: boolean; hasDeployed: boolean }) {
  const { dismissed, dismiss } = useDismissed('getting-started')
  if (dismissed) return null
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <h2 className="dash-card-title">Getting started</h2>
        <button type="button" className="btn btn-sm" onClick={dismiss} aria-label="Dismiss getting started">Dismiss</button>
      </div>
      <ul className="dash-checklist">
        <Item done={hasSiteUrl} label="Set your site URL" />
        <Item done={hasPost} label="Create your first post" />
        <Item done={hasDeployed} label="Deploy your site" />
      </ul>
    </section>
  )
}
