// screens-3.jsx — Settings (sectioned)
const { useState: us3 } = React;

const SETTINGS_NAV = [
  { id: 'permalinks', label: 'Permalinks', icon: 'link' },
  { id: 'seo', label: 'SEO defaults', icon: 'search' },
  { id: 'locales', label: 'Locales & i18n', icon: 'languages' },
  { id: 'users', label: 'Users & roles', icon: 'users' },
  { id: 'auth', label: 'Authentication', icon: 'key' },
  { id: 'integrations', label: 'Integrations', icon: 'layers' },
  { id: 'analytics', label: 'Analytics', icon: 'barChart' },
];

const USERS = [
  { name: 'Sarah Okafor', email: 'sarah@northwind.site', role: 'Admin', you: true },
  { name: 'Marcus Reed', email: 'marcus@northwind.site', role: 'Publisher' },
  { name: 'Priya Nair', email: 'priya@northwind.site', role: 'Editor' },
  { name: 'Jonah Klein', email: 'jonah@freelance.co', role: 'Viewer', pending: true },
];
const ROLE_TONE = { Admin: 'accent', Publisher: 'green', Editor: 'blue', Viewer: 'neutral' };

function Settings() {
  const { openProModal, addToast } = useApp();
  const [sec, setSec] = us3('permalinks');
  return (
    <>
      <PageHeader title="Settings" subtitle="Configure how your site is built, published, and accessed." />
      <div className="page-body settings-layout">
        <aside className="settings-nav">
          {SETTINGS_NAV.map(s => (
            <button key={s.id} className={`set-nav-item ${sec === s.id ? 'on' : ''}`} onClick={() => setSec(s.id)}>
              <Icon name={s.icon} size={16} /><span>{s.label}</span>
            </button>
          ))}
        </aside>
        <div className="settings-content">
          {sec === 'permalinks' && <PermalinksSettings />}
          {sec === 'seo' && <SeoSettings openProModal={openProModal} />}
          {sec === 'locales' && <LocaleSettings />}
          {sec === 'users' && <UserSettings openProModal={openProModal} addToast={addToast} />}
          {sec === 'auth' && <AuthSettings />}
          {sec === 'integrations' && <IntegrationSettings />}
          {sec === 'analytics' && <AnalyticsSettings />}
        </div>
      </div>
    </>
  );
}

function SetGroup({ title, desc, children, footer }) {
  return (
    <section className="set-group">
      <div className="set-group-head"><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
      <div className="set-card">{children}{footer && <div className="set-card-foot">{footer}</div>}</div>
    </section>
  );
}
function SetRow({ label, hint, children, stacked }) {
  return (
    <div className={`set-row ${stacked ? 'stacked' : ''}`}>
      <div className="set-row-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function PermalinksSettings() {
  return (
    <>
      <SetGroup title="URL structure" desc="Define how URLs are generated for each content type.">
        <SetRow label="Posts" hint="Articles and field notes"><Input prefix="northwind.site" defaultValue="/blog/{slug}" /></SetRow>
        <SetRow label="Pages" hint="Standalone pages"><Input prefix="northwind.site" defaultValue="/{slug}" /></SetRow>
        <SetRow label="Categories"><Input prefix="northwind.site" defaultValue="/topics/{category}" /></SetRow>
        <div className="set-callout"><Icon name="refresh" size={15} /><span>Changing a structure automatically creates <b>301 redirects</b> from old URLs, so nothing breaks.</span></div>
      </SetGroup>
      <SetGroup title="Trailing slashes">
        <SetRow label="Append trailing slash" hint="example.com/blog/ vs /blog"><Toggle checked={false} onChange={() => {}} /></SetRow>
        <SetRow label="Force lowercase URLs"><Toggle checked={true} onChange={() => {}} /></SetRow>
      </SetGroup>
      <SaveBar />
    </>
  );
}

function SeoSettings({ openProModal }) {
  return (
    <>
      <SetGroup title="Search engines">
        <SetRow label="Generate sitemap.xml" hint="Auto-updated on every deploy"><Toggle checked={true} onChange={() => {}} /></SetRow>
        <SetRow label="robots.txt" hint="Allow indexing"><Toggle checked={true} onChange={() => {}} /></SetRow>
        <SetRow label="Default meta title" stacked><Input defaultValue="Northwind — a calmer web studio" /></SetRow>
        <SetRow label="Default meta description" stacked><Textarea defaultValue="Northwind builds calm, fast websites for people who'd rather be making things." /></SetRow>
      </SetGroup>
      <SetGroup title="Default social image">
        <SetRow label="OG / Twitter card" stacked>
          <button className="meta-featured"><div className="meta-featured-ph"><Icon name="image" size={18} /></div><div className="meta-featured-text"><b>Upload 1200×630 image</b><span>Used when pages have no image set</span></div></button>
        </SetRow>
      </SetGroup>
      <ProLock icon="barChart" title="SEO scoring & suggestions"
        blurb="Real-time readability scores, keyword hints and a content audit across your whole site."
        onLearn={() => openProModal({ title: 'SEO scoring & suggestions', icon: 'barChart', blurb: 'Live readability and SEO analysis as you write.' })} />
      <SaveBar />
    </>
  );
}

function LocaleSettings() {
  const [locales, setLocales] = us3([{ code: 'EN', name: 'English', def: true }, { code: 'FR', name: 'Français' }, { code: 'DE', name: 'Deutsch' }]);
  return (
    <>
      <SetGroup title="Site languages" desc="Add locales and drag to set their order in the language switcher.">
        <div className="locale-rows">
          {locales.map((l, i) => (
            <div key={l.code} className="locale-row">
              <span className="locale-grip"><Icon name="grip" size={15} /></span>
              <span className="locale-code">{l.code}</span>
              <span className="locale-name">{l.name}</span>
              {l.def ? <Badge tone="accent">Default</Badge> : <button className="locale-setdef">Set default</button>}
              <button className="locale-remove" disabled={l.def}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
        <button className="set-add"><Icon name="plus" size={15} /> Add a language</button>
      </SetGroup>
      <SetGroup title="Fallback behavior">
        <SetRow label="Untranslated pages" hint="When a translation is missing">
          <Segmented value="fallback" options={[{ value: 'fallback', label: 'Show default' }, { value: 'hide', label: 'Hide' }, { value: '404', label: '404' }]} onChange={() => {}} />
        </SetRow>
      </SetGroup>
      <SaveBar />
    </>
  );
}

function UserSettings({ openProModal, addToast }) {
  const [menu, setMenu] = us3(null);
  return (
    <>
      <SetGroup title="Team members" desc="People with access to this workspace." footer={
        <div className="invite-bar">
          <Input icon="mail" placeholder="colleague@email.com" />
          <Segmented value="Editor" options={['Editor', 'Publisher', 'Admin']} onChange={() => {}} />
          <Button variant="primary" icon="send" onClick={() => addToast({ title: 'Invite sent', blurb: 'They’ll get an email to join.', tone: 'green' })}>Invite</Button>
        </div>
      }>
        <div className="user-table">
          {USERS.map((u, i) => (
            <div key={u.email} className="user-row">
              <Avatar name={u.name} size={34} />
              <div className="user-id"><span className="user-name">{u.name}{u.you && <span className="user-you">You</span>}{u.pending && <Badge tone="amber">Pending</Badge>}</span><span className="user-email">{u.email}</span></div>
              <div className="user-role" style={{ position: 'relative' }}>
                <button className={`role-pill tone-${ROLE_TONE[u.role]}`} onClick={() => setMenu(menu === i ? null : i)}>{u.role} <Icon name="chevDown" size={13} /></button>
                {menu === i && <Menu onClose={() => setMenu(null)} style={{ top: 34, right: 0 }} items={[
                  ...['Admin', 'Publisher', 'Editor', 'Viewer'].map(r => ({ label: r, icon: u.role === r ? 'check' : 'user', onClick: () => {} })),
                  { sep: true }, { label: 'Path-scoped access', icon: 'shield', pro: true, onClick: () => openProModal({ title: 'Path-scoped roles & audit log', icon: 'shield', blurb: 'Restrict editors to sections of the site, with a full audit trail.' }) },
                  { sep: true }, { label: 'Remove from team', icon: 'trash', danger: true },
                ]} />}
              </div>
            </div>
          ))}
        </div>
      </SetGroup>
      <div className="role-legend">
        {[['Admin', 'Full access incl. settings & billing'], ['Publisher', 'Can deploy to live'], ['Editor', 'Create & stage content'], ['Viewer', 'Read-only access']].map(([r, d]) => (
          <div key={r} className="role-legend-row"><Badge tone={ROLE_TONE[r]}>{r}</Badge><span>{d}</span></div>
        ))}
      </div>
      <ProLock icon="shield" title="Path-scoped roles & audit log"
        blurb="Scope editors to specific sections, and review every change with a full audit log."
        onLearn={() => openProModal({ title: 'Path-scoped roles & audit log', icon: 'shield' })} />
    </>
  );
}

function AuthSettings() {
  return (
    <>
      <SetGroup title="Sign-in provider" desc="How your team authenticates into Saytu.">
        <div className="auth-providers">
          {[{ n: 'Email + password', ic: 'mail', on: true }, { n: 'Google Workspace', ic: 'globe', on: true }, { n: 'GitHub', ic: 'gitBranch', on: false }, { n: 'SAML SSO', ic: 'key', on: false, pro: true }].map(p => (
            <div key={p.n} className={`auth-provider ${p.on ? 'on' : ''}`}>
              <span className="auth-ic"><Icon name={p.ic} size={17} /></span>
              <span className="auth-name">{p.n}{p.pro && <ProChip />}</span>
              {p.pro ? <Button variant="soft" size="sm">Upgrade</Button> : <Toggle checked={p.on} onChange={() => {}} />}
            </div>
          ))}
        </div>
      </SetGroup>
      <SetGroup title="Security">
        <SetRow label="Require 2FA for Admins"><Toggle checked={true} onChange={() => {}} /></SetRow>
        <SetRow label="Session length" hint="Auto sign-out after inactivity"><Segmented value="7d" options={['1d', '7d', '30d']} onChange={() => {}} /></SetRow>
      </SetGroup>
    </>
  );
}

function IntegrationSettings() {
  const INTS = [
    { n: 'Postmark', d: 'Transactional email for form replies', ic: 'mail', on: true },
    { n: 'Cloudinary', d: 'Image optimization & CDN', ic: 'image', on: true },
    { n: 'Amazon S3', d: 'Asset storage', ic: 'folder', on: false },
    { n: 'Slack', d: 'Deploy & form notifications', ic: 'bell', on: false },
  ];
  return (
    <>
      <SetGroup title="Connected services" desc="Tidy connections to the tools that power your site.">
        <div className="int-grid">
          {INTS.map(it => (
            <div key={it.n} className={`int-card ${it.on ? 'on' : ''}`}>
              <div className="int-card-top"><span className="int-ic"><Icon name={it.ic} size={18} /></span>{it.on && <Badge tone="green" dot>Connected</Badge>}</div>
              <div className="int-name">{it.n}</div>
              <div className="int-desc">{it.d}</div>
              <Button variant={it.on ? 'default' : 'soft'} size="sm" className="int-cta">{it.on ? 'Manage' : 'Connect'}</Button>
            </div>
          ))}
        </div>
      </SetGroup>
    </>
  );
}

function AnalyticsSettings() {
  return (
    <>
      <SetGroup title="Analytics snippet" desc="Admin-only. Injected site-wide before the closing </head>.">
        <div className="admin-only-tag"><Icon name="lock" size={12} /> Admin only</div>
        <Textarea className="code-field" defaultValue={'<script defer src="https://cdn.plausible.io/js/script.js"\n  data-domain="northwind.site"></script>'} style={{ fontFamily: 'var(--font-mono)', minHeight: 96, fontSize: 13 }} />
        <div className="set-callout"><Icon name="shield" size={15} /><span>Only Admins can view or edit this field. Changes deploy with the next build.</span></div>
      </SetGroup>
      <SaveBar />
    </>
  );
}

function SaveBar() {
  const { addToast } = useApp();
  return (
    <div className="save-bar">
      <span className="save-bar-note"><Icon name="check" size={14} /> All changes saved to Git</span>
      <div className="save-bar-actions">
        <Button variant="ghost">Discard</Button>
        <Button variant="primary" icon="check" onClick={() => addToast({ title: 'Settings saved', blurb: 'Committed to main.', tone: 'green' })}>Save changes</Button>
      </div>
    </div>
  );
}

Object.assign(window, { Settings });
