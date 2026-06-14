// editor-blocks.jsx — BlockRow + per-type rendering, top strip, preview pane
const { useState: ubS, useRef: ubR, useEffect: ubE } = React;

/* ============================================================
   BLOCK ROW
   ============================================================ */
function BlockRow(props) {
  const { block: b, index, active, selected, hover, dragOver, onHover, setRef, onInput, onKeyDown, onFocus, onSelect, onAdd, onDragStart, onDragOver, onDrop, updateBlock, removeBlock, openProModal, addToast } = props;
  const editableTypes = ['p', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'quote', 'callout', 'code'];
  const isEditable = editableTypes.includes(b.type);

  const ed = (extra = {}) => (
    <Editable tag={extra.tag || 'div'} blockId={b.id} setRef={setRef} html={b.content}
      className={extra.className} placeholder={extra.placeholder}
      onInput={e => onInput(b.id, e)} onKeyDown={e => onKeyDown(b.id, e)} onFocus={onFocus} />
  );

  let body;
  if (b.type === 'p') body = ed({ className: 'blk blk-p', placeholder: 'Write, or press “/” for blocks…' });
  else if (b.type === 'h1') body = ed({ tag: 'h1', className: 'blk blk-h1', placeholder: 'Heading 1' });
  else if (b.type === 'h2') body = ed({ tag: 'h2', className: 'blk blk-h2', placeholder: 'Heading 2' });
  else if (b.type === 'h3') body = ed({ tag: 'h3', className: 'blk blk-h3', placeholder: 'Heading 3' });
  else if (b.type === 'quote') body = <div className="blk blk-quote-wrap">{ed({ className: 'blk-quote', placeholder: 'Quote' })}</div>;
  else if (b.type === 'bullet') body = <div className="blk blk-li"><span className="li-marker" aria-hidden="true" />{ed({ className: 'blk-li-text', placeholder: 'List item' })}</div>;
  else if (b.type === 'numbered') body = <div className="blk blk-li blk-li-num"><span className="li-num" aria-hidden="true" />{ed({ className: 'blk-li-text', placeholder: 'List item' })}</div>;
  else if (b.type === 'code') body = <div className="blk blk-code">{ed({ className: 'blk-code-text', placeholder: '// code' })}</div>;
  else if (b.type === 'callout') body = (
    <div className={`blk blk-callout tone-${(b.props && b.props.tone) || 'accent'}`}>
      <button className="callout-ic" onClick={onSelect} title="Change icon"><Icon name={(b.props && b.props.icon) || 'sparkle'} size={18} /></button>
      {ed({ className: 'callout-text', placeholder: 'Type a callout…' })}
    </div>
  );
  else if (b.type === 'divider') body = <div className="blk blk-divider" onClick={onSelect}><hr /></div>;
  else if (b.type === 'image') body = <ImageBlock b={b} selected={selected} onSelect={onSelect} updateBlock={updateBlock} />;
  else if (b.type === 'columns') body = (
    <div className="blk blk-columns">
      <div className="col"><Editable blockId={b.id + '_l'} setRef={setRef} html={(b.props && b.props.left)} className="col-text" placeholder="Left column" onInput={() => {}} onKeyDown={() => {}} /></div>
      <div className="col-div" />
      <div className="col"><Editable blockId={b.id + '_r'} setRef={setRef} html={(b.props && b.props.right)} className="col-text" placeholder="Right column" onInput={() => {}} onKeyDown={() => {}} /></div>
    </div>
  );
  else if (b.type === 'dynamic') body = <DynamicChip b={b} selected={selected} onSelect={onSelect} openProModal={openProModal} updateBlock={updateBlock} />;

  return (
    <div className={`block-row ${active ? 'active' : ''} ${selected ? 'selected' : ''} ${dragOver ? 'drag-over' : ''} ${isEditable ? '' : 'is-atomic'}`}
      data-type={b.type}
      onMouseEnter={() => onHover(b.id)} onMouseLeave={() => onHover(null)}
      onDragOver={e => onDragOver(b.id, e)} onDrop={e => onDrop(b.id, e)}>
      <div className={`block-gutter ${hover || active ? 'show' : ''}`} contentEditable={false}>
        <Tip label="Add block below" side="top">
          <button className="gutter-btn" onMouseDown={e => e.preventDefault()} onClick={onAdd} aria-label="Add block"><Icon name="plus" size={15} /></button>
        </Tip>
        <Tip label="Drag to move · click for options" side="top">
          <button className="gutter-btn gutter-grip" draggable onDragStart={e => onDragStart(b.id, e)}
            onMouseDown={e => e.preventDefault()} onClick={onSelect} aria-label="Block options"><Icon name="grip" size={15} /></button>
        </Tip>
      </div>
      {body}
      {selected && !['p','h1','h2','h3','bullet','numbered','quote','code'].includes(b.type) && (
        <BlockProps b={b} updateBlock={updateBlock} removeBlock={removeBlock} openProModal={openProModal} />
      )}
    </div>
  );
}

function numberAmong() { return ''; }
function guessOrdinal() { return ''; }

/* ============================================================
   IMAGE BLOCK (alt text is first-class)
   ============================================================ */
function ImageBlock({ b, selected, onSelect, updateBlock }) {
  const p = b.props || {};
  const [editingAlt, setEditingAlt] = ubS(false);
  if (!p.filled) {
    return (
      <button className={`blk blk-image-empty ${selected ? 'on' : ''}`} onClick={() => updateBlock(b.id, { props: { ...p, filled: true, alt: '' } })}>
        <span className="img-empty-ic"><Icon name="image" size={22} /></span>
        <span className="img-empty-text"><b>Add an image</b><span>Drop a file, paste a URL, or pick from Media</span></span>
        <span className="img-empty-cta">Browse Media</span>
      </button>
    );
  }
  return (
    <figure className={`blk blk-image ${selected ? 'on' : ''}`} onClick={onSelect}>
      <div className="img-frame" data-empty="false">
        <div className="img-ph" aria-label={p.alt}>
          <Icon name="image" size={26} />
        </div>
        <span className={`img-alt-badge ${p.alt ? 'ok' : 'warn'}`} onClick={e => { e.stopPropagation(); setEditingAlt(true); }}>
          {p.alt ? <><Icon name="check" size={12} />ALT</> : <><Icon name="alert" size={12} />Add alt text</>}
        </span>
      </div>
      {editingAlt ? (
        <div className="img-alt-edit" onClick={e => e.stopPropagation()}>
          <Icon name="type" size={14} />
          <input autoFocus defaultValue={p.alt} placeholder="Describe this image for screen readers…"
            onBlur={e => { updateBlock(b.id, { props: { ...p, alt: e.target.value } }); setEditingAlt(false); }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        </div>
      ) : (
        <figcaption className="img-caption" onClick={e => { e.stopPropagation(); }}>
          {p.caption || 'Add a caption…'}
        </figcaption>
      )}
    </figure>
  );
}

/* ============================================================
   DYNAMIC / PRO CHIP — read-only block
   ============================================================ */
function DynamicChip({ b, selected, onSelect, openProModal, updateBlock }) {
  const p = b.props || {};
  return (
    <div className={`blk blk-dynamic ${selected ? 'on' : ''}`} onClick={onSelect}
      role="group" aria-label="Conditional content block, available on Pro">
      <div className="dyn-rail" />
      <div className="dyn-head">
        <span className="dyn-ic"><Icon name="zap" size={16} /></span>
        <span className="dyn-title">Conditional content</span>
        <ProChip />
        <span className="dyn-lock"><Icon name="lock" size={13} /></span>
      </div>
      <div className="dyn-rule"><span className="dyn-rule-label">When</span><code>{p.rule || 'audience matches a rule'}</code></div>
      <div className="dyn-body">This block changes per visitor. Marketers can’t edit it visually on the free plan.</div>
      <button className="dyn-cta" onClick={e => { e.stopPropagation(); openProModal({ title: 'Visual content rules', icon: 'zap', blurb: 'Build conditionals, variables and loops visually — no code, no developer.' }); }}>
        Edit in Visual Builder <Icon name="arrowRight" size={13} />
      </button>
    </div>
  );
}

/* ============================================================
   CONTEXTUAL PROPS PANEL (selected atomic block)
   ============================================================ */
function BlockProps({ b, updateBlock, removeBlock, openProModal }) {
  const p = b.props || {};
  return (
    <div className="block-props" contentEditable={false} onMouseDown={e => e.preventDefault()}>
      {b.type === 'callout' && (
        <>
          <span className="bp-label">Tone</span>
          {['accent', 'green', 'amber', 'red'].map(t => (
            <button key={t} className={`bp-swatch tone-${t} ${p.tone === t ? 'on' : ''}`} onClick={() => updateBlock(b.id, { props: { ...p, tone: t } })} aria-label={t} />
          ))}
          <span className="bp-sep" />
          {['sparkle', 'callout', 'zap', 'pin'].map(ic => (
            <button key={ic} className={`bp-icon ${p.icon === ic ? 'on' : ''}`} onClick={() => updateBlock(b.id, { props: { ...p, icon: ic } })}><Icon name={ic} size={15} /></button>
          ))}
        </>
      )}
      {b.type === 'image' && (
        <>
          <span className="bp-label">Width</span>
          {['Inset', 'Wide', 'Full'].map(w => (
            <button key={w} className={`bp-pill ${(p.width || 'Wide') === w ? 'on' : ''}`} onClick={() => updateBlock(b.id, { props: { ...p, width: w } })}>{w}</button>
          ))}
          <span className="bp-sep" />
          <button className="bp-pill" onClick={() => updateBlock(b.id, { props: { ...p, filled: false } })}><Icon name="refresh" size={13} /> Replace</button>
        </>
      )}
      {b.type === 'divider' && <span className="bp-muted">Divider</span>}
      {b.type === 'dynamic' && <span className="bp-muted"><Icon name="lock" size={13} /> Read-only on the free plan</span>}
      {b.type === 'columns' && <span className="bp-muted">2 columns · 50 / 50</span>}
      <span className="bp-sep" />
      <button className="bp-icon danger" onClick={() => removeBlock(b.id)} aria-label="Delete block"><Icon name="trash" size={15} /></button>
    </div>
  );
}

/* ============================================================
   TOP STRIP
   ============================================================ */
function EditorTopStrip({ status, saved, typing, locale, setLocale, localeOpen, setLocaleOpen, preview, setPreview, onBack, onStage, onOpenMeta, metaOpen }) {
  const LOCALES = [{ code: 'EN', name: 'English' }, { code: 'FR', name: 'Français' }, { code: 'DE', name: 'Deutsch' }, { code: 'ES', name: 'Español' }];
  return (
    <div className="ed-strip surface-tx">
      <div className="ed-strip-left">
        <Tip label="Back to Posts" side="bottom"><button className="strip-btn btn-icononly" onClick={onBack} aria-label="Back"><Icon name="chevLeft" size={18} /></button></Tip>
        <StatusPill status={status} lifecycle />
      </div>

      <div className="ed-strip-center">
        <div className={`autosave ${typing ? 'saving' : ''}`}>
          {typing ? <><Icon name="loader" size={14} className="spin" /> Saving…</> : <><Icon name="check" size={14} /> Saved</>}
          <span className="autosave-time">· just now</span>
        </div>
        <span className="strip-div" />
        <div className="presence">
          <span className="presence-lock"><Icon name="lock" size={12} /></span>
          <Avatar name="Sarah Okafor" size={22} ring />
          <span className="presence-text">You’re editing</span>
        </div>
      </div>

      <div className="ed-strip-right">
        <div className="locale-wrap">
          <button className="strip-btn locale-btn" onClick={() => setLocaleOpen(o => !o)}>
            <Icon name="languages" size={16} /> {locale} <Icon name="chevDown" size={13} />
          </button>
          {localeOpen && (
            <Menu onClose={() => setLocaleOpen(false)} style={{ top: 40, right: 0 }}
              items={[
                ...LOCALES.map(l => ({ label: `${l.name} (${l.code})`, icon: locale === l.code ? 'check' : 'globe', onClick: () => setLocale(l.code) })),
                { sep: true },
                { label: 'Translation workspace', icon: 'languages', pro: true, onClick: () => {} },
              ]} />
          )}
        </div>
        <Tip label="Split preview" side="bottom">
          <button className={`strip-btn btn-icononly ${preview ? 'on' : ''}`} onClick={() => setPreview(p => !p)} aria-label="Preview"><Icon name="eye" size={17} /></button>
        </Tip>
        <button className="btn btn-default btn-sm" onClick={onStage}><Icon name="layers" size={15} /> Stage</button>
        <Tip label="Document settings" side="bottom">
          <button className={`strip-btn btn-icononly ${metaOpen ? 'on' : ''}`} onClick={onOpenMeta} aria-label="Settings"><Icon name="panelRight" size={17} /></button>
        </Tip>
      </div>
    </div>
  );
}

/* ============================================================
   PREVIEW PANE
   ============================================================ */
function PreviewPane({ doc, blocks, onClose }) {
  return (
    <div className="preview-pane">
      <div className="preview-bar">
        <div className="preview-url"><Icon name="globe" size={14} /> northwind.site/blog/{(doc.slug || 'the-quiet-week')}</div>
        <div className="preview-bar-right">
          <Segmented size="sm" value="desktop" options={[{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Mobile' }]} onChange={() => {}} />
          <Tip label="Close preview" side="bottom"><button className="strip-btn btn-icononly" onClick={onClose}><Icon name="x" size={16} /></button></Tip>
        </div>
      </div>
      <div className="preview-scroll">
        <article className="preview-doc" style={{ fontFamily: 'var(--font-canvas)' }}>
          <h1>{doc.title || 'Untitled'}</h1>
          <div className="preview-meta">By Sarah Okafor · 6 min read</div>
          {blocks.map(b => {
            if (b.type === 'h1') return <h2 key={b.id}>{b.content}</h2>;
            if (b.type === 'h2') return <h3 key={b.id}>{b.content}</h3>;
            if (b.type === 'h3') return <h4 key={b.id}>{b.content}</h4>;
            if (b.type === 'quote') return <blockquote key={b.id}>{b.content}</blockquote>;
            if (b.type === 'bullet') return <li key={b.id}>{b.content}</li>;
            if (b.type === 'numbered') return <li key={b.id} className="ol">{b.content}</li>;
            if (b.type === 'callout') return <aside key={b.id} className="pv-callout">{b.content}</aside>;
            if (b.type === 'divider') return <hr key={b.id} />;
            if (b.type === 'code') return <pre key={b.id}>{b.content}</pre>;
            if (b.type === 'image') return <figure key={b.id}><div className="pv-img"><Icon name="image" size={24} /></div>{b.props && b.props.caption && <figcaption>{b.props.caption}</figcaption>}</figure>;
            if (b.type === 'dynamic') return <div key={b.id} className="pv-dynamic"><Icon name="zap" size={13} /> Personalized content renders here at publish time</div>;
            if (b.type === 'columns') return <div key={b.id} className="pv-cols"><div>{b.props && b.props.left}</div><div>{b.props && b.props.right}</div></div>;
            return <p key={b.id}>{b.content}</p>;
          })}
        </article>
      </div>
    </div>
  );
}

Object.assign(window, { BlockRow, ImageBlock, DynamicChip, BlockProps, EditorTopStrip, PreviewPane });
