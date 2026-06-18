import { useState } from 'react'
import { useCan } from '../auth/actor'
import { useDeploy } from '../deploy/deploy'
import { Icon } from '../ui/Icon'

export function DeployButton() {
  const can = useCan()
  const { sha, deploy } = useDeploy()
  const [busy, setBusy] = useState(false)
  if (!can('site.deploy')) return null

  const onDeploy = async () => {
    if (busy) return
    setBusy(true)
    try {
      await deploy()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="deploy-btn" onClick={() => void onDeploy()} disabled={busy} aria-label="Deploy site">
      <Icon name="globe" size={16} />
      <span>{busy ? 'Deploying…' : sha ? `Deployed · ${sha.slice(0, 7)}` : 'Deploy site'}</span>
    </button>
  )
}
