// screens-2.jsx — Media, Forms, Site
const { useState: us2 } = React;

/* ============================================================
   MEDIA LIBRARY
   ============================================================ */
const MEDIA = [
  { id: 1, name: 'studio-morning.jpg', alt: 'Sunlit desk with a notebook and coffee', dims: '2400×1600', size: '842 KB', ratio: 1.5, hue: 28, used: 3 },
  { id: 2, name: 'team-offsite.jpg', alt: 'The team around a wooden table', dims: '3000×2000', size: '1.2 MB', ratio: 1.5, hue: 200, used: 1 },
  { id: 3, name: 'product-hero.png', alt: '', dims: '1600×1200', size: '410 KB', ratio: 1.33, hue: 260, used: 0 },
  { id: 4, name: 'logo-mark.svg', alt: 'Setu logo mark', dims: '512×512', size: '4 KB', ratio: 1, hue: 245, used: 12 },
  { id: 5, name: 'pricing-bg.jpg', alt: 'Soft gradient backdrop', dims: '2000×1125', size: '690 KB', ratio: 1.77, hue: 160, used: 1 },
  { id: 6, name: 'founder-portrait.jpg', alt: '', dims: '1200×1500', size: '520 KB', ratio: 0.8, hue: 12, used: 2 },
  { id: 7, name: 'field-notes-cover.jpg', alt: 'Open notebook with handwriting', dims: '2400×1350', size: '910 KB', ratio: 1.77, hue: 45, used: 1 },
  { id: 8, name: 'office-plants.jpg', alt: 'Plants by a bright window', dims: '1800×1800', size: '760 KB', ratio: 1, hue: 130, used: 0 },
];

function Media() {
  const [q, setQ] = us2('');
  const [detail, setDetail] = us2(null);
  const [folder, setFolder] = us2('all');
  const rows = MEDIA.filter(m => m.name.toLowerCase().includes(q.toLowerCase()) || m.alt.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Media" count={MEDIA.length} subtitle="Images and files, reusable across your site."
        actions={<>
          <Button variant="default" icon="folder">New folder</Button>
          <Button variant="primary" icon="upload">Upload</Button>
        </>}
        search={q} onSearch={setQ} searchPlaceholder="Search by name or alt text…" />

      <div className="page-body media-layout">
        <aside className="media-folders">
          {[{ id: 'all', label: 'All media', icon: 'image', n: 128 }, { id: 'posts', label: 'Posts', icon: 'post', n: 64 }, { id: 'brand', label: 'Brand', icon: 'star', n: 18 }, { id: 'uploads', label: 'Uploads', icon: 'folder', n: 46 }].map(f => (
            <button key={f.id} className={`folder-item ${folder === f.id ? 'on' : ''}`} onClick={() => setFolder(f.id)}>
              <Icon name={f.icon} size={16} /><span>{f.label}</span><span className="folder-n">{f.n}</span>
            </button>
          ))}
          <div className="media-usage">
            <div className="media-usage-head"><span>Storage</span><span>2.4 / 5 GB</span></div>
            <div className="media-usage-bar"><span style={{ width: '48%' }} /></div>
            <button className="media-usage-pro" >Need more? <b>Go Pro</b></button>
          </div>
        </aside>

        <div className="media-main">
          <div className="media-dropzone">
            <Icon name="upload" size={18} /> <span>Drag images here to upload, or <b>browse files</b></span>
          </div>
          {rows.length === 0 ? (
            <EmptyState icon="image" title={q ? `No media match “${q}”` : 'Your library is empty'}
              blurb={q ? 'Try another search term.' : 'Upload images and files to reuse them anywhere on your site.'}
              action={!q && <Button variant="primary" icon="upload">Upload media</Button>} />
          ) : (
            <div className="media-grid">
              {rows.map(m => (
                <button key={m.id} className={`media-card ${detail && detail.id === m.id ? 'on' : ''}`} onClick={() => setDetail(m)}>
                  <div className="media-thumb" style={{ aspectRatio: m.ratio, background: `linear-gradient(150deg, hsl(${m.hue} 55% 62%), hsl(${m.hue + 30} 50% 48%))` }}>
                    <Icon name={m.name.endsWith('.svg') ? 'star' : 'image'} size={22} />
                    {!m.alt && <span className="media-noalt"><Icon name="alert" size={11} /> No alt</span>}
                  </div>
                  <div className="media-cap"><span className="media-name">{m.name}</span><span className="media-dims">{m.dims}</span></div>
                </button>
              ))}
            </div>
          )}
        </div>

        {detail && <MediaDetail m={detail} onClose={() => setDetail(null)} />}
      </div>
    </>
  );
}

function MediaDetail({ m, onClose }) {
  const [alt, setAlt] = us2(m.alt);
  return (
    <aside className="media-detail">
      <div className="media-detail-head"><span>Asset</span><button className="strip-btn btn-icononly" onClick={onClose}><Icon name="x" size={16} /></button></div>
      <div className="media-detail-scroll">
        <div className="media-detail-preview" style={{ aspectRatio: m.ratio, background: `linear-gradient(150deg, hsl(${m.hue} 55% 62%), hsl(${m.hue + 30} 50% 48%))` }}>
          <Icon name={m.name.endsWith('.svg') ? 'star' : 'image'} size={30} />
        </div>
        <div className="media-detail-name">{m.name}</div>
        <div className="media-detail-grid">
          <div><span>Dimensions</span><b>{m.dims}</b></div>
          <div><span>Size</span><b>{m.size}</b></div>
          <div><span>Used in</span><b>{m.used} place{m.used === 1 ? '' : 's'}</b></div>
          <div><span>Type</span><b>{m.name.split('.').pop().toUpperCase()}</b></div>
        </div>
        <Field label="Alt text" hint="Describe the image for screen readers and SEO.">
          <Textarea value={alt} onChange={e => setAlt(e.target.value)} placeholder="Describe this image…" style={{ minHeight: 64 }} />
        </Field>
        <Field label="Filename"><Input defaultValue={m.name} /></Field>
        <div className="media-detail-actions">
          <Button variant="default" size="sm" icon="link">Copy URL</Button>
          <Button variant="default" size="sm" icon="download">Download</Button>
          <Button variant="danger" size="sm" icon="trash">Delete</Button>
        </div>
      </div>
    </aside>
  );
}

/* ============================================================
   FORMS
   ============================================================ */
const FORMS = [
  { id: 'contact', name: 'Contact', fields: ['Name', 'Email', 'Message'], entries: 18, unread: 3, last: '2h ago' },
  { id: 'newsletter', name: 'Newsletter signup', fields: ['Email'], entries: 142, unread: 0, last: '20m ago' },
  { id: 'demo', name: 'Request a demo', fields: ['Name', 'Company', 'Email', 'Team size'], entries: 0, unread: 0, last: '—' },
];
const SUBS = [
  { id: 1, name: 'Lena Hartmann', email: 'lena@meadowlark.co', message: 'Love the editor — is there an API for headless use?', when: 'Jun 14, 9:12 AM', unread: true },
  { id: 2, name: 'Tom Briggs', email: 'tom@northstar.io', message: 'We’d like to migrate ~400 posts from WordPress. Possible?', when: 'Jun 13, 4:40 PM', unread: true },
  { id: 3, name: 'Aisha Bello', email: 'aisha@studioluma.com', message: 'Does the free plan include multiple locales?', when: 'Jun 13, 11:02 AM', unread: true },
  { id: 4, name: 'Diego Marín', email: 'diego@verdant.app', message: 'Beautiful work. Any plans for a dark theme on the public site?', when: 'Jun 12, 6:21 PM' },
  { id: 5, name: 'Karim Saleh', email: 'karim@brightfold.com', message: 'How does Git-backed publishing handle merge conflicts?', when: 'Jun 12, 1:15 PM' },
];

function Forms() {
  const [active, setActive] = us2('contact');
  const [openSub, setOpenSub] = us2(1);
  const form = FORMS.find(f => f.id === active);

  return (
    <>
      <PageHeader title="Forms" count={FORMS.length} subtitle="Collect submissions and read them in one place."
        actions={<Button variant="primary" icon="plus">New form</Button>} />
      <div className="page-body forms-layout">
        <aside className="forms-list">
          {FORMS.map(f => (
            <button key={f.id} className={`form-item ${active === f.id ? 'on' : ''}`} onClick={() => { setActive(f.id); setOpenSub(null); }}>
              <span className="form-item-ic"><Icon name="forms" size={16} /></span>
              <span className="form-item-main"><span className="form-item-name">{f.name}</span><span className="form-item-sub">{f.entries} entries · {f.last}</span></span>
              {f.unread > 0 && <span className="form-unread">{f.unread}</span>}
            </button>
          ))}
        </aside>

        <div className="forms-inbox">
          <div className="forms-inbox-head">
            <div className="forms-inbox-titles"><h2>{form.name}</h2><div className="forms-inbox-meta">{form.fields.map(f => <span key={f} className="field-pill">{f}</span>)}</div></div>
            <div className="forms-inbox-actions">
              <Button variant="ghost" size="sm" icon="settings">Edit form</Button>
              <Button variant="default" size="sm" icon="download" disabled={form.entries === 0}>Export CSV</Button>
            </div>
          </div>

          {form.entries === 0 ? (
            <EmptyState icon="forms" title="No submissions yet"
              blurb="Share this form on your site — entries will land here the moment someone responds."
              action={<Button variant="default" icon="link">Copy form embed</Button>} mini />
          ) : (
            <div className="subs">
              {SUBS.slice(0, active === 'newsletter' ? 4 : 5).map(s => (
                <div key={s.id} className={`sub-row ${s.unread ? 'unread' : ''} ${openSub === s.id ? 'open' : ''}`}>
                  <button className="sub-main" onClick={() => setOpenSub(openSub === s.id ? null : s.id)}>
                    {s.unread && <span className="sub-dot" />}
                    <Avatar name={s.name} size={30} />
                    <span className="sub-id"><span className="sub-name">{s.name}</span><span className="sub-email">{active === 'newsletter' ? s.email : s.message}</span></span>
                    <span className="sub-when">{s.when}</span>
                    <Icon name="chevDown" size={15} className="sub-chev" />
                  </button>
                  {openSub === s.id && active !== 'newsletter' && (
                    <div className="sub-detail">
                      <div className="sub-field"><span>Name</span><b>{s.name}</b></div>
                      <div className="sub-field"><span>Email</span><b><a href="#">{s.email}</a></b></div>
                      <div className="sub-field"><span>Message</span><p>{s.message}</p></div>
                      <div className="sub-detail-actions"><Button variant="default" size="sm" icon="mail">Reply</Button><Button variant="ghost" size="sm" icon="trash">Delete</Button></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ============================================================
   SITE — publish & deploy
   ============================================================ */
const DEPLOYS = [
  { id: 'd1', status: 'Building', branch: 'main', commit: 'b7e1a0', msg: 'Stage: pricing update', when: 'now', dur: '12s', by: 'Marcus Reed' },
  { id: 'd2', status: 'Deployed', branch: 'main', commit: 'a3f9c1', msg: 'Publish: field notes', when: '2h ago', dur: '41s', by: 'Sarah Okafor' },
  { id: 'd3', status: 'Deployed', branch: 'main', commit: '5c2d88', msg: 'Fix: footer links', when: 'Yesterday', dur: '38s', by: 'Priya Nair' },
  { id: 'd4', status: 'Failed', branch: 'main', commit: '0f4ab2', msg: 'Add OG images', when: '2d ago', dur: '8s', by: 'Marcus Reed' },
  { id: 'd5', status: 'Deployed', branch: 'main', commit: 'e9c731', msg: 'Initial launch', when: '5d ago', dur: '52s', by: 'Sarah Okafor' },
];

function Site() {
  const { addToast, openProModal } = useApp();
  const [copied, setCopied] = us2(false);
  return (
    <>
      <PageHeader title="Site" subtitle="Preview, deploy, and watch your site go live." />
      <div className="page-body"><div className="page-body-pad site-grid">
        <div className="site-main">
          <section className="panel deploy-hero">
            <div className="deploy-hero-top">
              <div><div className="deploy-hero-label">Production</div><a className="deploy-hero-url" href="#">northwind.site <Icon name="external" size={14} /></a></div>
              <Badge tone="green" dot soft={false} className="deploy-hero-badge">Live</Badge>
            </div>
            <div className="deploy-hero-lifecycle"><StatusPill status="Deployed" lifecycle /></div>
            <div className="deploy-hero-actions">
              <Button variant="primary" size="lg" icon="rocket" onClick={() => addToast({ title: 'Deploy queued', blurb: 'Building from main — about 40s.', tone: 'accent', icon: 'rocket' })}>Deploy live</Button>
              <Button variant="default" size="lg" icon="eye">Open preview</Button>
              <span className="deploy-role-note"><Icon name="shield" size={13} /> You can deploy as <b>Publisher</b></span>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Deploy history</h2><button className="panel-link">View all <Icon name="arrowRight" size={13} /></button></div>
            <div className="deploy-list">
              {DEPLOYS.map(d => (
                <div key={d.id} className="deploy-row">
                  <span className={`deploy-status-ic s-${d.status.toLowerCase()}`}>
                    <Icon name={d.status === 'Building' ? 'loader' : d.status === 'Failed' ? 'alert' : 'check'} size={14} className={d.status === 'Building' ? 'spin' : ''} />
                  </span>
                  <div className="deploy-row-main">
                    <div className="deploy-row-msg">{d.msg}</div>
                    <div className="deploy-row-meta"><Icon name="gitBranch" size={12} /> {d.branch} · <span className="mono">{d.commit}</span> · {d.by}</div>
                  </div>
                  <Badge tone={STATUS_MAP[d.status] ? STATUS_MAP[d.status].tone : 'neutral'} dot>{d.status}</Badge>
                  <span className="deploy-row-when">{d.dur} · {d.when}</span>
                  <button className="deploy-logs">Logs <Icon name="arrowRight" size={12} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="site-rail">
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Shareable preview</h2></div>
            <p className="rail-blurb">Send a private link to review the staged site — no login required.</p>
            <div className="share-link">
              <Icon name="link" size={14} />
              <span className="share-url">northwind.site/preview/…a3f9</span>
              <button className="share-copy" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <><Icon name="check" size={13} /> Copied</> : 'Copy'}</button>
            </div>
            <ProLock inline icon="lock" title="Password-protect previews" onLearn={() => openProModal({ title: 'Shareable draft previews', icon: 'eye', blurb: 'Expiring, password-protected preview links for stakeholders.' })} />
          </section>

          <section className="panel build-panel">
            <div className="panel-head"><h2 className="panel-title">Build</h2><Badge tone="blue" dot>Building</Badge></div>
            <div className="build-log">
              <div className="build-line"><span className="mono dim">09:42:01</span> Cloning main@b7e1a0…</div>
              <div className="build-line"><span className="mono dim">09:42:03</span> Installing dependencies</div>
              <div className="build-line"><span className="mono dim">09:42:09</span> Building 128 pages</div>
              <div className="build-line active"><span className="mono dim">09:42:12</span> Optimizing images… <span className="spin-text">▍</span></div>
            </div>
          </section>
        </aside>
      </div></div>
    </>
  );
}

Object.assign(window, { Media, MediaDetail, Forms, Site });
