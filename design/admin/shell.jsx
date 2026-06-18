// shell.jsx — App context, sidebar nav, page header, command palette, toasts
const { useState: useStateS, useRef: useRefS, useEffect: useEffectS, useCallback: useCallbackS, createContext: createContextS, useContext: useContextS } = React;

const AppContext = createContextS(null);
const useApp = () => useContextS(AppContext);

/* Navigation model */
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { group: 'Content' },
  { id: 'posts', label: 'Posts', icon: 'post' },
  { id: 'pages', label: 'Pages', icon: 'pages' },
  { id: 'types', label: 'Custom types', icon: 'layers', pro: true },
  { group: 'Workspace' },
  { id: 'media', label: 'Media', icon: 'image' },
  { id: 'forms', label: 'Forms', icon: 'forms' },
  { id: 'site', label: 'Site', icon: 'globe' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

/* ============================================================
   LOGO
   ============================================================ */
function Logo({ size = 26 }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size} height={size} fill="none">
        <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
        <path d="M21.5 11.5c-1-1.4-2.8-2.2-4.9-2.2-3 0-5 1.5-5 3.8 0 2 1.4 3 4.3 3.6l1.6.4c1.5.3 2.1.8 2.1 1.6 0 1-1 1.7-2.6 1.7-1.6 0-2.8-.7-3.4-1.9"
          stroke="var(--on-accent)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/* ============================================================
   SIDEBAR
   ============================================================ */
function Sidebar() {
  const { route, go, collapsed, setCollapsed, openCmd, openProModal, theme, setTheme } = useApp();
  return (
    <aside className={`sidebar surface-tx ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-top">
        <button className="ws" onClick={() => go('dashboard')} title="Setu workspace">
          <Logo size={28} />
          <span className="ws-meta">
            <span className="ws-name">Setu</span>
            <span className="ws-sub">northwind.site</span>
          </span>
          <Icon name="chevDown" size={14} className="ws-chev" />
        </button>
        <Tip label={collapsed ? 'Expand' : 'Collapse sidebar'} side="right">
          <button className="sidebar-collapse btn-icononly" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar">
            <Icon name="collapse" size={17} style={{ transform: collapsed ? 'scaleX(-1)' : 'none' }} />
          </button>
        </Tip>
      </div>

      <button className="search-btn" onClick={openCmd}>
        <Icon name="search" size={16} />
        <span>Search…</span>
        <kbd className="kbd">⌘K</kbd>
      </button>

      <nav className="nav" aria-label="Primary">
        {NAV.map((it, i) => it.group
          ? <div key={i} className="nav-group">{it.group}</div>
          : (
            <Tip key={it.id} label={it.label} side="right">
              <button
                className={`nav-item ${route === it.id ? 'on' : ''} ${it.pro ? 'is-pro' : ''}`}
                onClick={() => it.pro ? openProModal({ title: 'Custom content types', icon: 'layers', blurb: 'Define your own structured content types and fields with the visual builder.' }) : go(it.id)}
                aria-current={route === it.id ? 'page' : undefined}>
                <Icon name={it.icon} size={18} />
                <span className="nav-label">{it.label}</span>
                {it.pro && <span className="nav-lock"><Icon name="lock" size={12} /></span>}
              </button>
            </Tip>
          )
        )}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-util">
          <Tip label="Content syncs to your Git repo" side="right">
            <div className="topology">
              <span className="topo-pulse" />
              <span className="topo-label"><b>Local</b><span className="topo-sep">·</span>Tunnel</span>
              <Icon name="gitBranch" size={14} className="topo-git" />
            </div>
          </Tip>
          <Tip label={theme === 'dark' ? 'Light mode' : 'Dark mode'} side="top">
            <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
          </Tip>
        </div>
        <button className="userchip" onClick={() => go('settings')}>
          <Avatar name="Sarah Okafor" size={26} />
          <span className="userchip-meta">
            <span className="userchip-name">Sarah Okafor</span>
            <span className="userchip-role">Publisher</span>
          </span>
          <Icon name="dots" size={15} className="userchip-more" />
        </button>
      </div>
    </aside>
  );
}

/* ============================================================
   PAGE HEADER (used by non-editor screens)
   ============================================================ */
function PageHeader({ title, count, subtitle, actions, tabs, activeTab, onTab, search, onSearch, searchPlaceholder = 'Search…' }) {
  return (
    <header className="page-head surface-tx">
      <div className="page-head-row">
        <div className="page-head-titles">
          <h1 className="page-title">{title}{typeof count === 'number' && <span className="page-count">{count}</span>}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        <div className="page-head-actions">{actions}</div>
      </div>
      {(tabs || search) && (
        <div className="page-head-row page-head-toolbar">
          {tabs && (
            <div className="tabs" role="tablist">
              {tabs.map(t => (
                <button key={t.id} role="tab" aria-selected={activeTab === t.id}
                  className={`tab ${activeTab === t.id ? 'on' : ''}`} onClick={() => onTab(t.id)}>
                  {t.label}{typeof t.count === 'number' && <span className="tab-count">{t.count}</span>}
                </button>
              ))}
            </div>
          )}
          {search !== undefined && (
            <div className="page-search">
              <Input icon="search" placeholder={searchPlaceholder} value={search} onChange={e => onSearch(e.target.value)} />
            </div>
          )}
        </div>
      )}
    </header>
  );
}

/* ============================================================
   COMMAND PALETTE
   ============================================================ */
function CommandPalette() {
  const { cmdOpen, setCmdOpen, go, theme, setTheme, openProModal } = useApp();
  const [q, setQ] = useStateS('');
  const [sel, setSel] = useStateS(0);
  const inputRef = useRefS(null);

  const cmds = [
    { id: 'new-post', label: 'New post', icon: 'plus', kind: 'Create', run: () => go('editor') },
    { id: 'new-page', label: 'New page', icon: 'pages', kind: 'Create', run: () => go('editor') },
    { id: 'go-dashboard', label: 'Go to Dashboard', icon: 'dashboard', kind: 'Navigate', run: () => go('dashboard') },
    { id: 'go-posts', label: 'Go to Posts', icon: 'post', kind: 'Navigate', run: () => go('posts') },
    { id: 'go-pages', label: 'Go to Pages', icon: 'pages', kind: 'Navigate', run: () => go('pages') },
    { id: 'go-media', label: 'Go to Media', icon: 'image', kind: 'Navigate', run: () => go('media') },
    { id: 'go-forms', label: 'Go to Forms', icon: 'forms', kind: 'Navigate', run: () => go('forms') },
    { id: 'go-site', label: 'Go to Site & Deploys', icon: 'globe', kind: 'Navigate', run: () => go('site') },
    { id: 'go-settings', label: 'Go to Settings', icon: 'settings', kind: 'Navigate', run: () => go('settings') },
    { id: 'theme', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: theme === 'dark' ? 'sun' : 'moon', kind: 'Preferences', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    { id: 'deploy', label: 'Deploy live', icon: 'rocket', kind: 'Actions', run: () => go('site') },
    { id: 'history', label: 'Version history', icon: 'clock', kind: 'Actions', pro: true, run: () => openProModal({ title: 'Version history & rollback', icon: 'clock', blurb: 'Browse every revision and restore any past version in one click.' }) },
  ];
  const filtered = cmds.filter(c => c.label.toLowerCase().includes(q.toLowerCase()));

  useEffectS(() => { if (cmdOpen) { setQ(''); setSel(0); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); } }, [cmdOpen]);
  useEffectS(() => { setSel(0); }, [q]);

  if (!cmdOpen) return null;
  const close = () => setCmdOpen(false);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = filtered[sel]; if (c) { c.run(); close(); } }
    else if (e.key === 'Escape') { close(); }
  };

  let lastKind = null;
  return (
    <div className="cmd-scrim" onMouseDown={close}>
      <div className="cmd" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="cmd-input-row">
          <Icon name="search" size={18} className="cmd-search-ic" />
          <input ref={inputRef} className="cmd-input" placeholder="Search commands, content, settings…"
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="cmd-list" role="listbox">
          {filtered.length === 0 && <div className="cmd-empty">No matches for “{q}”</div>}
          {filtered.map((c, i) => {
            const head = c.kind !== lastKind ? <div key={'h' + c.kind} className="cmd-group">{c.kind}</div> : null;
            lastKind = c.kind;
            return (
              <React.Fragment key={c.id}>
                {head}
                <button className={`cmd-item ${i === sel ? 'sel' : ''}`} role="option" aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)} onClick={() => { c.run(); close(); }}>
                  <Icon name={c.icon} size={17} />
                  <span className="cmd-item-label">{c.label}</span>
                  {c.pro && <ProChip />}
                  <Icon name="arrowRight" size={15} className="cmd-item-go" />
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="cmd-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate</span>
          <span><kbd className="kbd">↵</kbd> select</span>
          <span className="cmd-foot-spacer" />
          <span>Setu Command</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TOASTS
   ============================================================ */
function ToastHost() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.tone || 'neutral'}`}>
          <Icon name={t.icon || (t.tone === 'green' ? 'checkCircle' : t.tone === 'red' ? 'alert' : 'bell')} size={17} />
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.blurb && <div className="toast-blurb">{t.blurb}</div>}
          </div>
          {t.action && <button className="toast-action" onClick={() => { t.action.run(); dismissToast(t.id); }}>{t.action.label}</button>}
          <button className="toast-x" onClick={() => dismissToast(t.id)} aria-label="Dismiss"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   PRO MODAL
   ============================================================ */
function ProModal() {
  const { proModal, closeProModal } = useApp();
  if (!proModal) return null;
  const FEATURES = ['Visual builders for conditionals, variables & loops', 'Custom content types & field builder', 'Version history, rollback & scheduled publishing', 'Translation workspace & editorial approvals', 'Real-time collaboration & audit log'];
  return (
    <div className="cmd-scrim" onMouseDown={closeProModal}>
      <div className="promodal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Setu Pro">
        <button className="promodal-x" onClick={closeProModal} aria-label="Close"><Icon name="x" size={16} /></button>
        <div className="promodal-glow" />
        <div className="promodal-ic"><Icon name={proModal.icon || 'sparkle'} size={22} /></div>
        <ProChip label="Setu Pro" size="md" />
        <h2 className="promodal-title">{proModal.title}</h2>
        <p className="promodal-blurb">{proModal.blurb || 'Unlock the full publishing toolkit for growing teams.'}</p>
        <ul className="promodal-list">
          {FEATURES.map(f => <li key={f}><Icon name="check" size={15} />{f}</li>)}
        </ul>
        <div className="promodal-actions">
          <Button variant="primary" size="lg" icon="sparkle" onClick={closeProModal}>Upgrade to Pro</Button>
          <Button variant="ghost" size="lg" onClick={closeProModal}>Maybe later</Button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AppContext, useApp, NAV, Logo, Sidebar, PageHeader, CommandPalette, ToastHost, ProModal });
