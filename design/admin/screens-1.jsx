// screens-1.jsx — Dashboard + Content list (Posts / Pages)
const { useState: us1 } = React;

/* ============================================================
   DASHBOARD
   ============================================================ */
const RECENT = [
  { title: 'The quiet week before a launch', type: 'Post', status: 'Draft', when: 'Editing now', you: true, locale: 'EN' },
  { title: 'Pricing', type: 'Page', status: 'Staged', when: '12m ago', who: 'Marcus Reed', locale: 'EN' },
  { title: 'Field notes: designing for calm', type: 'Post', status: 'Deployed', when: '2h ago', who: 'Sarah Okafor', locale: 'EN · FR' },
  { title: 'About the studio', type: 'Page', status: 'Deployed', when: 'Yesterday', who: 'Priya Nair', locale: 'EN' },
];
const ACTIVITY = [
  { who: 'Marcus Reed', action: 'staged', what: 'Pricing', when: '12m', icon: 'layers' },
  { who: 'You', action: 'edited', what: 'The quiet week before a launch', when: '18m', icon: 'edit' },
  { who: 'Priya Nair', action: 'deployed', what: 'About the studio', when: '1d', icon: 'rocket' },
  { who: 'Marcus Reed', action: 'uploaded 3 images to', what: 'Media', when: '1d', icon: 'upload' },
];

function Dashboard() {
  const { go, addToast } = useApp();
  return (
    <>
      <header className="page-head dash-head surface-tx">
        <div className="page-head-row">
          <div className="page-head-titles">
            <h1 className="page-title">Good afternoon, Sarah</h1>
            <p className="page-subtitle">Here’s what’s moving on <b>northwind.site</b> today.</p>
          </div>
          <div className="page-head-actions">
            <Button variant="default" icon="pages" onClick={() => go('editor')}>New page</Button>
            <Button variant="primary" icon="plus" onClick={() => go('editor')}>New post</Button>
          </div>
        </div>
      </header>

      <div className="page-body"><div className="page-body-pad dash-grid">
        <div className="dash-main">
          <div className="dash-stats">
            {[
              { label: 'Published', value: '128', sub: 'pages & posts', icon: 'post', tone: '' },
              { label: 'In draft', value: '6', sub: '2 staged for review', icon: 'edit', tone: 'amber' },
              { label: 'Form entries', value: '34', sub: 'this week', icon: 'forms', tone: 'accent' },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <span className={`stat-ic tone-${s.tone || 'neutral'}`}><Icon name={s.icon} size={17} /></span>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
                <div className="stat-sub">{s.sub}</div>
              </div>
            ))}
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Continue where you left off</h2>
              <button className="panel-link" onClick={() => go('posts')}>All content <Icon name="arrowRight" size={13} /></button>
            </div>
            <div className="continue-row">
              {RECENT.slice(0, 2).map((r, i) => (
                <button key={i} className="continue-card" onClick={() => go('editor')}>
                  <div className="continue-top"><Badge tone={STATUS_MAP[r.status].tone} dot>{r.status}</Badge>{r.you && <span className="continue-live"><span className="live-dot" /> You</span>}</div>
                  <div className="continue-title" style={{ fontFamily: 'var(--font-canvas)' }}>{r.title}</div>
                  <div className="continue-foot"><Icon name={r.type === 'Post' ? 'post' : 'pages'} size={13} /> {r.type} · {r.when}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Recently updated</h2>
              <button className="panel-link" onClick={() => go('posts')}>View all <Icon name="arrowRight" size={13} /></button>
            </div>
            <div className="mini-table">
              {RECENT.map((r, i) => (
                <button key={i} className="mini-row" onClick={() => go('editor')}>
                  <span className="mini-ic"><Icon name={r.type === 'Post' ? 'post' : 'pages'} size={16} /></span>
                  <span className="mini-title">{r.title}</span>
                  <Badge tone={STATUS_MAP[r.status].tone} dot>{r.status}</Badge>
                  <span className="mini-locale">{r.locale}</span>
                  <span className="mini-when">{r.when}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="dash-rail">
          <section className="panel deploy-panel">
            <div className="panel-head"><h2 className="panel-title">Deploy status</h2><Badge tone="green" dot>Live</Badge></div>
            <div className="deploy-lifecycle"><StatusPill status="Deployed" lifecycle /></div>
            <div className="deploy-meta">
              <div className="deploy-meta-row"><Icon name="gitBranch" size={14} /> <code>main</code> · <span className="mono">a3f9c1</span></div>
              <div className="deploy-meta-row"><Icon name="clock" size={14} /> Deployed 2h ago · 41s build</div>
            </div>
            <div className="deploy-actions">
              <Button variant="default" size="sm" icon="eye" onClick={() => go('site')}>Preview</Button>
              <Button variant="primary" size="sm" icon="rocket" onClick={() => addToast({ title: 'Deploy queued', blurb: 'Building from main…', tone: 'accent', icon: 'rocket' })}>Deploy live</Button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Activity</h2></div>
            <div className="activity">
              {ACTIVITY.map((a, i) => (
                <div key={i} className="activity-row">
                  <span className="activity-ic"><Icon name={a.icon} size={13} /></span>
                  <div className="activity-text"><b>{a.who}</b> {a.action} <a onClick={() => go(a.what === 'Media' ? 'media' : 'editor')}>{a.what}</a></div>
                  <span className="activity-when">{a.when}</span>
                </div>
              ))}
            </div>
          </section>

          <ProLockRail />
        </aside>
      </div></div>
    </>
  );
}

function ProLockRail() {
  const { openProModal } = useApp();
  return (
    <ProLock icon="users" title="Invite your team"
      blurb="Real-time collaboration, editorial approvals and an audit log come with Saytu Pro."
      onLearn={() => openProModal({ title: 'Real-time collaboration', icon: 'users', blurb: 'Write together live, with approvals and a full audit trail.' })} />
  );
}

/* ============================================================
   CONTENT LIST (Posts / Pages)
   ============================================================ */
const POSTS = [
  { id: 1, title: 'The quiet week before a launch', status: 'Draft', author: 'Sarah Okafor', locale: ['EN'], updated: 'Editing now', locked: 'you' },
  { id: 2, title: 'Field notes: designing for calm', status: 'Deployed', author: 'Sarah Okafor', locale: ['EN', 'FR'], updated: '2h ago' },
  { id: 3, title: 'Why we went Git-backed', status: 'Staged', author: 'Marcus Reed', locale: ['EN'], updated: '5h ago', locked: 'Marcus' },
  { id: 4, title: 'A short history of the humble CMS', status: 'Deployed', author: 'Priya Nair', locale: ['EN', 'DE'], updated: 'Yesterday' },
  { id: 5, title: 'Shipping in the open', status: 'Deployed', author: 'Sarah Okafor', locale: ['EN'], updated: '3d ago' },
  { id: 6, title: 'The editor we always wanted', status: 'Draft', author: 'Marcus Reed', locale: ['EN'], updated: '4d ago' },
  { id: 7, title: 'Notes on typography for reading', status: 'Deployed', author: 'Priya Nair', locale: ['EN', 'FR', 'DE'], updated: '1w ago' },
];

function ContentList({ kind = 'posts' }) {
  const { go, addToast, openProModal } = useApp();
  const isPosts = kind === 'posts';
  const [tab, setTab] = us1('all');
  const [q, setQ] = us1('');
  const [sel, setSel] = us1(new Set());
  const [menuRow, setMenuRow] = us1(null);

  const all = isPosts ? POSTS : POSTS.slice(1, 5).map(p => ({ ...p, title: ['Home', 'Pricing', 'About the studio', 'Contact'][p.id - 2] || p.title }));
  const byTab = all.filter(p => tab === 'all' || (tab === 'published' && p.status === 'Deployed') || (tab === 'draft' && p.status === 'Draft') || (tab === 'staged' && p.status === 'Staged'));
  const rows = byTab.filter(p => p.title.toLowerCase().includes(q.toLowerCase()));
  const counts = { all: all.length, published: all.filter(p => p.status === 'Deployed').length, draft: all.filter(p => p.status === 'Draft').length, staged: all.filter(p => p.status === 'Staged').length };

  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = rows.length > 0 && rows.every(r => sel.has(r.id));

  return (
    <>
      <PageHeader title={isPosts ? 'Posts' : 'Pages'} count={all.length}
        subtitle={isPosts ? 'Articles, field notes and announcements.' : 'Standalone pages and landing pages.'}
        actions={<>
          <Button variant="default" icon="filter">Filter</Button>
          <Button variant="primary" icon="plus" onClick={() => go('editor')}>New {isPosts ? 'post' : 'page'}</Button>
        </>}
        tabs={[{ id: 'all', label: 'All', count: counts.all }, { id: 'published', label: 'Published', count: counts.published }, { id: 'draft', label: 'Drafts', count: counts.draft }, { id: 'staged', label: 'Staged', count: counts.staged }]}
        activeTab={tab} onTab={setTab}
        search={q} onSearch={setQ} searchPlaceholder={`Search ${isPosts ? 'posts' : 'pages'}…`} />

      <div className="page-body"><div className="list-wrap">
        {sel.size > 0 && (
          <div className="bulk-bar">
            <span className="bulk-count">{sel.size} selected</span>
            <span className="bulk-sep" />
            <button className="bulk-btn"><Icon name="layers" size={14} /> Stage</button>
            <button className="bulk-btn"><Icon name="tag" size={14} /> Tag</button>
            <button className="bulk-btn" onClick={() => openProModal({ title: 'Scheduled publishing', icon: 'clock', blurb: 'Queue posts to deploy automatically.' })}><Icon name="clock" size={14} /> Schedule <ProChip /></button>
            <button className="bulk-btn danger"><Icon name="trash" size={14} /> Delete</button>
            <button className="bulk-btn ghost" onClick={() => setSel(new Set())}>Clear</button>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState icon={isPosts ? 'post' : 'pages'}
            title={q ? `No ${isPosts ? 'posts' : 'pages'} match “${q}”` : `No ${isPosts ? 'posts' : 'pages'} yet`}
            blurb={q ? 'Try a different search, or clear the filter.' : `Start writing — your first ${isPosts ? 'post' : 'page'} is a slash command away.`}
            action={!q && <Button variant="primary" icon="plus" onClick={() => go('editor')}>New {isPosts ? 'post' : 'page'}</Button>}
            secondary={q && <Button variant="default" onClick={() => setQ('')}>Clear search</Button>} />
        ) : (
          <table className="ctable">
            <thead>
              <tr>
                <th className="ct-check"><Checkbox checked={allChecked} onChange={() => setSel(allChecked ? new Set() : new Set(rows.map(r => r.id)))} /></th>
                <th>Title</th><th className="ct-status">Status</th><th className="ct-author">Author</th><th className="ct-locale">Locale</th><th className="ct-updated">Updated</th><th className="ct-menu"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={sel.has(r.id) ? 'on' : ''}>
                  <td className="ct-check" onClick={e => e.stopPropagation()}><Checkbox checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="ct-title" onClick={() => go('editor')}>
                    <span className="ct-title-ic"><Icon name={isPosts ? 'post' : 'pages'} size={15} /></span>
                    <span className="ct-title-text">{r.title}</span>
                    {r.locked && <Tip label={r.locked === 'you' ? 'You’re editing' : `${r.locked} is editing`} side="top"><span className={`ct-lock ${r.locked === 'you' ? 'you' : ''}`}><Icon name="lock" size={11} /></span></Tip>}
                  </td>
                  <td className="ct-status"><Badge tone={STATUS_MAP[r.status].tone} dot>{r.status}</Badge></td>
                  <td className="ct-author"><span className="ct-author-cell"><Avatar name={r.author} size={22} /> {r.author.split(' ')[0]}</span></td>
                  <td className="ct-locale"><span className="locale-pills">{r.locale.map(l => <span key={l} className="locale-pill">{l}</span>)}</span></td>
                  <td className="ct-updated">{r.updated}</td>
                  <td className="ct-menu" style={{ position: 'relative' }}>
                    <button className="ct-menu-btn" onClick={() => setMenuRow(menuRow === r.id ? null : r.id)} aria-label="Row actions"><Icon name="more" size={16} /></button>
                    {menuRow === r.id && <Menu onClose={() => setMenuRow(null)} style={{ top: 36, right: 8 }}
                      items={[
                        { label: 'Open in editor', icon: 'edit', onClick: () => go('editor') },
                        { label: 'View live', icon: 'external' },
                        { label: 'Duplicate', icon: 'copy' },
                        { label: 'Version history', icon: 'clock', pro: true, onClick: () => openProModal({ title: 'Version history & rollback', icon: 'clock' }) },
                        { sep: true },
                        { label: 'Delete', icon: 'trash', danger: true },
                      ]} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div></div>
    </>
  );
}

function Checkbox({ checked, onChange }) {
  return <button className={`checkbox ${checked ? 'on' : ''}`} role="checkbox" aria-checked={checked} onClick={onChange}>{checked && <Icon name="check" size={12} />}</button>;
}

Object.assign(window, { Dashboard, ContentList, Checkbox });
