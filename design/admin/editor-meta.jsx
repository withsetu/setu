// editor-meta.jsx — right slide-over: metadata, SEO, advanced
const { useState: umS } = React;

function MetaSection({ title, icon, children, defaultOpen = true, pro, action }) {
  const [open, setOpen] = umS(defaultOpen);
  return (
    <section className={`meta-section ${open ? 'open' : ''}`}>
      <button className="meta-section-head" onClick={() => setOpen(o => !o)}>
        <Icon name="chevRight" size={15} className="meta-chev" />
        {icon && <Icon name={icon} size={15} className="meta-section-ic" />}
        <span className="meta-section-title">{title}</span>
        {pro && <ProChip />}
        {action}
      </button>
      {open && <div className="meta-section-body">{children}</div>}
    </section>
  );
}

function MetaRow({ label, children, stacked }) {
  return (
    <div className={`meta-row ${stacked ? 'stacked' : ''}`}>
      <span className="meta-row-label">{label}</span>
      <div className="meta-row-control">{children}</div>
    </div>
  );
}

function TagInput({ tags, setTags, placeholder, tone = 'neutral' }) {
  const [v, setV] = umS('');
  return (
    <div className="tag-input">
      {tags.map((t, i) => (
        <span key={t} className={`tag-chip tone-${tone}`}>{t}<button onClick={() => setTags(tags.filter((_, j) => j !== i))} aria-label={`Remove ${t}`}><Icon name="x" size={11} /></button></span>
      ))}
      <input value={v} placeholder={tags.length ? '' : placeholder}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && v.trim()) { setTags([...tags, v.trim()]); setV(''); } else if (e.key === 'Backspace' && !v && tags.length) { setTags(tags.slice(0, -1)); } }} />
    </div>
  );
}

function MetaPanel() {
  const { metaOpen, setMetaOpen, doc, setDoc, openProModal } = useApp();
  const [cats, setCats] = umS(['Product']);
  const [tags, setTags] = umS(['launch', 'studio', 'writing']);
  const slug = doc.slug || 'the-quiet-week';
  const metaTitle = doc.title || 'The quiet week before a launch';
  const metaDescLen = (doc.metaDesc || '').length;

  if (!metaOpen) return null;
  return (
    <>
      <div className="meta-scrim" onClick={() => setMetaOpen(false)} />
      <aside className="meta-panel surface-tx" role="dialog" aria-label="Document settings">
        <div className="meta-head">
          <span className="meta-head-title"><Icon name="settings" size={16} /> Document</span>
          <button className="strip-btn btn-icononly" onClick={() => setMetaOpen(false)} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        <div className="meta-scroll">
          <MetaSection title="Status & visibility" icon="dot">
            <MetaRow label="Status">
              <Segmented size="sm" value="Draft" options={['Draft', 'Staged', 'Deployed']} onChange={() => {}} />
            </MetaRow>
            <MetaRow label="Author">
              <button className="meta-author"><Avatar name="Sarah Okafor" size={22} /> Sarah Okafor <Icon name="chevDown" size={13} /></button>
            </MetaRow>
            <MetaRow label="Publish date">
              <Input icon="calendar" defaultValue="Jun 14, 2026 · 09:00" />
            </MetaRow>
            <ProLock inline icon="clock" title="Schedule for later" onLearn={() => openProModal({ title: 'Scheduled publishing', icon: 'clock', blurb: 'Queue posts to deploy automatically at the perfect moment.' })} />
          </MetaSection>

          <MetaSection title="Permalink" icon="link">
            <MetaRow label="Slug" stacked>
              <Input prefix="/blog/" value={slug} onChange={e => setDoc(d => ({ ...d, slug: e.target.value }))} />
            </MetaRow>
            <div className="meta-hint"><Icon name="refresh" size={12} /> Changing the slug auto-creates a redirect.</div>
          </MetaSection>

          <MetaSection title="Locale" icon="languages">
            <MetaRow label="Language">
              <Segmented size="sm" value="EN" options={['EN', 'FR', 'DE']} onChange={() => {}} />
            </MetaRow>
            <div className="meta-translations">
              <div className="meta-trans-row"><span className="flag">🇫🇷</span> Français <Badge tone="amber">Outdated</Badge></div>
              <div className="meta-trans-row"><span className="flag">🇩🇪</span> Deutsch <Badge tone="neutral">Not started</Badge></div>
            </div>
            <ProLock inline icon="languages" title="Open translation workspace" onLearn={() => openProModal({ title: 'Translation management', icon: 'languages', blurb: 'A side-by-side workspace to translate and keep every locale in sync.' })} />
          </MetaSection>

          <MetaSection title="Organize" icon="tag">
            <MetaRow label="Categories" stacked>
              <TagInput tags={cats} setTags={setCats} placeholder="Add a category…" tone="accent" />
            </MetaRow>
            <MetaRow label="Tags" stacked>
              <TagInput tags={tags} setTags={setTags} placeholder="Add a tag…" />
            </MetaRow>
          </MetaSection>

          <MetaSection title="Featured image" icon="image">
            <button className="meta-featured">
              <div className="meta-featured-ph"><Icon name="image" size={20} /></div>
              <div className="meta-featured-text"><b>Set a featured image</b><span>Used in cards & social shares</span></div>
            </button>
          </MetaSection>

          <MetaSection title="SEO" icon="search" defaultOpen={false} action={<span className="seo-score" onClick={e => { e.stopPropagation(); openProModal({ title: 'SEO scoring & suggestions', icon: 'barChart', blurb: 'Live readability and SEO analysis as you write.' }); }}>Score <Icon name="lock" size={11} /></span>}>
            <MetaRow label="Meta title" stacked>
              <Input defaultValue={metaTitle} maxLength={60} />
              <div className="char-meter"><span style={{ width: `${Math.min(100, metaTitle.length / 60 * 100)}%` }} /></div>
              <div className="meta-hint">{metaTitle.length} / 60 characters</div>
            </MetaRow>
            <MetaRow label="Meta description" stacked>
              <Textarea defaultValue="A short field note on building a calmer place to write — and what ships in Setu today." maxLength={160}
                onChange={e => setDoc(d => ({ ...d, metaDesc: e.target.value }))} />
              <div className="char-meter"><span className={metaDescLen > 160 ? 'over' : ''} style={{ width: `${Math.min(100, (metaDescLen || 88) / 160 * 100)}%` }} /></div>
              <div className="meta-hint">{metaDescLen || 88} / 160 characters</div>
            </MetaRow>
            <MetaRow label="Canonical URL" stacked>
              <Input icon="link" defaultValue="https://northwind.site/blog/the-quiet-week" />
            </MetaRow>
            <MetaRow label="Social / OG image" stacked>
              <button className="meta-featured compact">
                <div className="meta-featured-ph"><Icon name="image" size={18} /></div>
                <div className="meta-featured-text"><b>1200×630 share image</b><span>Falls back to featured image</span></div>
              </button>
            </MetaRow>
            <div className="og-preview">
              <div className="og-img"><Icon name="image" size={18} /></div>
              <div className="og-meta"><div className="og-site">northwind.site</div><div className="og-title">{metaTitle}</div><div className="og-desc">A short field note on building a calmer place to write…</div></div>
            </div>
          </MetaSection>

          <MetaSection title="Advanced" icon="code" defaultOpen={false}>
            <MetaRow label="Raw source"><button className="meta-source-btn"><Icon name="terminal" size={14} /> View Markdown source</button></MetaRow>
            <div className="meta-source">
              <div className="meta-source-line"><span className="src-key">title:</span> {metaTitle}</div>
              <div className="meta-source-line"><span className="src-key">slug:</span> /blog/{slug}</div>
              <div className="meta-source-line"><span className="src-key">status:</span> draft</div>
              <div className="meta-source-line"><span className="src-key">locale:</span> en</div>
              <div className="meta-source-line src-dim">--- # body follows ---</div>
            </div>
            <ProLock inline icon="clock" title="Version history & rollback" onLearn={() => openProModal({ title: 'Version history & rollback', icon: 'clock', blurb: 'Every save is a version. Compare and restore in one click.' })} />
          </MetaSection>
        </div>
      </aside>
    </>
  );
}

Object.assign(window, { MetaPanel, MetaSection, MetaRow, TagInput });
