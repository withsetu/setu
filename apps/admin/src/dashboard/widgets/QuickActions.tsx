// apps/admin/src/dashboard/widgets/QuickActions.tsx
import { Link } from 'react-router-dom'
import { Icon } from '../../ui/Icon'

export function QuickActions() {
  return (
    <section className="dash-card">
      <h2 className="dash-card-title">Quick actions</h2>
      <div className="dash-actions">
        <Link to="/edit/post/en/new" className="btn btn-primary btn-md">
          <Icon name="plus" size={16} />
          <span>New post</span>
        </Link>
        <Link to="/edit/page/en/new" className="btn btn-md">
          <Icon name="plus" size={16} />
          <span>New page</span>
        </Link>
      </div>
    </section>
  )
}
