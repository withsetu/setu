export function SiteStatusCard({
  url, deployedSha, topology,
}: { url: string; deployedSha: string | null; topology: string }) {
  return (
    <section className="dash-card">
      <h2 className="dash-card-title">Site</h2>
      <dl className="dash-status">
        <div className="dash-status-row">
          <dt>Topology</dt>
          <dd><span className="badge badge-neutral badge-soft pill-sm">{topology}</span></dd>
        </div>
        <div className="dash-status-row">
          <dt>URL</dt>
          <dd><a href={url} target="_blank" rel="noopener noreferrer" className="ctable-muted">{url}</a></dd>
        </div>
        <div className="dash-status-row">
          <dt>Deploy</dt>
          <dd>{deployedSha === null ? 'Not deployed' : `Deployed ${deployedSha.slice(0, 7)}`}</dd>
        </div>
      </dl>
      <button type="button" className="btn btn-md" disabled title="Remote sync is not connected yet">
        Sync remote changes
      </button>
    </section>
  )
}
