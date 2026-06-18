// editor.jsx — The Editor (centerpiece): canvas, blocks, slash menu, focus mode, top strip
const { useState: uS, useRef: uR, useEffect: uE, useCallback: uC, useLayoutEffect: uLE } = React;

let __bid = 100;
const nbid = () => 'b' + (++__bid);
let BLOCKS_CACHE = null; // persists editor blocks across navigation without writing React state

const SLASH_BLOCKS = [
  { type: 'p', label: 'Text', icon: 'type', desc: 'Plain paragraph', kw: 'paragraph body text plain' },
  { type: 'h1', label: 'Heading 1', icon: 'h1', desc: 'Large section title', kw: 'title big' },
  { type: 'h2', label: 'Heading 2', icon: 'h2', desc: 'Medium heading', kw: 'subtitle' },
  { type: 'h3', label: 'Heading 3', icon: 'heading', desc: 'Small heading', kw: 'minor' },
  { type: 'bullet', label: 'Bulleted list', icon: 'list', desc: 'Simple bullet point', kw: 'unordered ul' },
  { type: 'numbered', label: 'Numbered list', icon: 'listOrdered', desc: 'Ordered list item', kw: 'ordered ol number' },
  { type: 'quote', label: 'Quote', icon: 'quote', desc: 'Capture a pull-quote', kw: 'blockquote cite' },
  { type: 'callout', label: 'Callout', icon: 'callout', desc: 'Highlight with an icon', kw: 'note info tip' },
  { type: 'image', label: 'Image', icon: 'image', desc: 'Upload with alt text', kw: 'photo picture media' },
  { type: 'divider', label: 'Divider', icon: 'divider', desc: 'Visual separator', kw: 'hr line rule' },
  { type: 'code', label: 'Code', icon: 'code', desc: 'Monospaced snippet', kw: 'snippet pre' },
  { type: 'columns', label: 'Columns', icon: 'columns', desc: 'Side-by-side layout', kw: 'grid layout' },
  { type: 'dynamic', label: 'Conditional content', icon: 'zap', desc: 'Show by audience or rule', kw: 'dynamic personalize variable loop', pro: true },
];

const SEED_BLOCKS = () => [
  { id: nbid(), type: 'p', content: 'There’s a particular kind of quiet that settles over a small studio the week before a launch. The phones stop ringing. The Slack channel goes still. And the work — the actual work — finally has room to breathe.' },
  { id: nbid(), type: 'h2', content: 'Designing for calm' },
  { id: nbid(), type: 'p', content: 'We started Setu because publishing on the modern web had quietly become a second job. Every CMS wanted to be a platform; none of them wanted to be a place to write.' },
  { id: nbid(), type: 'callout', content: 'The best tool is the one that disappears the moment you start typing.', props: { tone: 'accent', icon: 'sparkle' } },
  { id: nbid(), type: 'image', content: '', props: { alt: 'A wide, sunlit desk with a single notebook and a cup of coffee', caption: 'Our studio, the morning of the first deploy.', filled: true } },
  { id: nbid(), type: 'h2', content: 'What ships today' },
  { id: nbid(), type: 'bullet', content: 'A full-bleed editor that stays out of your way' },
  { id: nbid(), type: 'bullet', content: 'Git-backed versioning, so nothing is ever truly lost' },
  { id: nbid(), type: 'bullet', content: 'One-click deploys from draft to live' },
  { id: nbid(), type: 'dynamic', content: 'Conditional content — Pro', props: { rule: 'Visitors from the EU · after first visit' } },
  { id: nbid(), type: 'p', content: 'We can’t wait to see what you make with it.' },
];

/* ---------------- Editable primitive ---------------- */
function Editable({ html, tag = 'div', className, placeholder, onInput, onKeyDown, blockId, setRef, ...rest }) {
  const ref = uR(null);
  uE(() => { if (ref.current && ref.current.textContent !== html) ref.current.textContent = html || ''; }, []); // mount only
  uE(() => { if (setRef) setRef(blockId, ref.current); return () => setRef && setRef(blockId, null); }, []);
  const Tag = tag;
  return (
    <Tag ref={ref} className={className} contentEditable suppressContentEditableWarning
      data-ph={placeholder} data-empty={!html ? 'true' : 'false'}
      onInput={e => { e.currentTarget.setAttribute('data-empty', e.currentTarget.textContent ? 'false' : 'true'); onInput && onInput(e); }}
      onKeyDown={onKeyDown} spellCheck="true" {...rest} />
  );
}

/* ---------------- Editor ---------------- */
function Editor() {
  const { go, tweaks, addToast, setMetaOpen, metaOpen, openProModal, doc, setDoc } = useApp();
  const [blocks, setBlocks] = uS(() => BLOCKS_CACHE || doc.blocks || SEED_BLOCKS());
  const [slash, setSlash] = uS(null);          // {blockId, query, top, left}
  const [slashSel, setSlashSel] = uS(0);
  const [activeId, setActiveId] = uS(null);
  const [selectedId, setSelectedId] = uS(null);  // non-text block selected
  const [typing, setTyping] = uS(false);
  const [hoverId, setHoverId] = uS(null);
  const [saved, setSaved] = uS(true);
  const domRefs = uR({});
  const typingTimer = uR(null);
  const dragFrom = uR(null);
  const [dragOver, setDragOver] = uS(null);
  const titleRef = uR(null);

  const setRef = uC((id, el) => { if (el) domRefs.current[id] = el; else delete domRefs.current[id]; }, []);
  const focusMode = tweaks.focusMode !== 'off';
  const dimAmount = tweaks.focusMode === 'spotlight' ? 0.18 : tweaks.focusMode === 'dim' ? 0.34 : 0.5;

  // sync DOM text into model
  const syncDom = uC(() => {
    setBlocks(bs => bs.map(b => {
      const el = domRefs.current[b.id];
      return el ? { ...b, content: el.textContent } : b;
    }));
  }, []);

  const markDirty = uC(() => {
    setSaved(false);
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => { setTyping(false); setSaved(true); }, 1400);
  }, []);

  uE(() => () => clearTimeout(typingTimer.current), []);
  uE(() => { BLOCKS_CACHE = blocks; }, [blocks]); // cache only — no React state write, avoids re-render cascade

  /* ----- block ops ----- */
  const updateBlock = (id, patch) => setBlocks(bs => bs.map(b => b.id === id ? { ...b, ...patch } : b));
  const insertAfter = (id, block, focus = true) => {
    setBlocks(bs => { const i = bs.findIndex(b => b.id === id); const nb = [...bs]; nb.splice(i + 1, 0, block); return nb; });
    if (focus) setTimeout(() => { const el = domRefs.current[block.id]; if (el) { el.focus(); placeCaretEnd(el); } }, 20);
  };
  const removeBlock = (id, focusPrev = true) => {
    setBlocks(bs => {
      const i = bs.findIndex(b => b.id === id);
      if (bs.length <= 1) return bs;
      const nb = bs.filter(b => b.id !== id);
      if (focusPrev && i > 0) { const prev = bs[i - 1]; setTimeout(() => { const el = domRefs.current[prev.id]; if (el) { el.focus(); placeCaretEnd(el); } }, 20); }
      return nb;
    });
  };

  /* ----- slash menu ----- */
  const slashFiltered = slash ? SLASH_BLOCKS.filter(b => {
    const q = slash.query.toLowerCase();
    return !q || b.label.toLowerCase().includes(q) || b.kw.includes(q);
  }) : [];

  const openSlashFor = (id) => {
    const el = domRefs.current[id];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cr = document.querySelector('.ed-scroll').getBoundingClientRect();
    setSlash({ blockId: id, query: '', top: r.bottom - cr.top + 6, left: r.left - cr.left });
    setSlashSel(0);
  };
  const closeSlash = () => setSlash(null);

  const applySlash = (item) => {
    const id = slash.blockId;
    if (item.pro && item.type === 'dynamic') {
      // insert a Pro dynamic chip block instead of opening modal directly (discovery)
      const el = domRefs.current[id]; if (el) el.textContent = '';
      updateBlock(id, { type: 'dynamic', content: 'Conditional content — Pro', props: { rule: 'Add a rule' } });
      closeSlash(); markDirty();
      return;
    }
    const el = domRefs.current[id]; if (el) el.textContent = '';
    if (item.type === 'divider') { updateBlock(id, { type: 'divider', content: '' }); insertAfter(id, { id: nbid(), type: 'p', content: '' }); }
    else if (item.type === 'image') { updateBlock(id, { type: 'image', content: '', props: { filled: false, alt: '' } }); setSelectedId(id); }
    else if (item.type === 'columns') { updateBlock(id, { type: 'columns', content: '', props: { left: 'Left column', right: 'Right column' } }); }
    else { updateBlock(id, { type: item.type, content: '' }); setTimeout(() => { const e2 = domRefs.current[id]; if (e2) { e2.setAttribute('data-empty', 'true'); e2.focus(); } }, 10); }
    closeSlash(); markDirty();
  };

  const onBlockInput = (id, e) => {
    const text = e.currentTarget.textContent;
    if (text.startsWith('/') && !text.includes(' ', 1) && text.length < 22) {
      if (!slash || slash.blockId !== id) openSlashFor(id);
      setSlash(s => s ? { ...s, query: text.slice(1) } : s); setSlashSel(0);
    } else if (slash && slash.blockId === id) { closeSlash(); }
    markDirty();
  };

  const onBlockKey = (id, e) => {
    if (slash && slash.blockId === id) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSel(s => Math.min(s + 1, slashFiltered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSel(s => Math.max(s - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); const it = slashFiltered[slashSel]; if (it) applySlash(it); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
    }
    const block = blocks.find(b => b.id === id);
    const el = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey && block && block.type !== 'code') {
      e.preventDefault();
      const caretAtEnd = caretIsAtEnd(el);
      if ((block.type === 'bullet' || block.type === 'numbered')) {
        if (!el.textContent.trim()) { updateBlock(id, { type: 'p' }); el.setAttribute('data-empty', 'true'); return; }
        insertAfter(id, { id: nbid(), type: block.type, content: '' });
      } else {
        insertAfter(id, { id: nbid(), type: 'p', content: '' });
      }
      return;
    }
    if (e.key === 'Backspace' && !el.textContent && block) {
      e.preventDefault();
      if (block.type !== 'p') { updateBlock(id, { type: 'p' }); el.setAttribute('data-empty', 'true'); }
      else { removeBlock(id); }
      return;
    }
    if (e.key === 'ArrowUp' && caretIsAtStart(el)) { focusSibling(id, -1); }
    if (e.key === 'ArrowDown' && caretIsAtEnd(el)) { focusSibling(id, 1); }
  };

  const focusSibling = (id, dir) => {
    const i = blocks.findIndex(b => b.id === id);
    const t = blocks[i + dir];
    if (t && domRefs.current[t.id]) { const el = domRefs.current[t.id]; el.focus(); placeCaretEnd(el); }
  };

  /* ----- drag reorder ----- */
  const onDragStart = (id, e) => { dragFrom.current = id; e.dataTransfer.effectAllowed = 'move'; syncDom(); };
  const onDragOverBlock = (id, e) => { e.preventDefault(); setDragOver(id); };
  const onDrop = (id, e) => {
    e.preventDefault();
    const from = dragFrom.current; if (!from || from === id) { setDragOver(null); return; }
    setBlocks(bs => {
      const fi = bs.findIndex(b => b.id === from), ti = bs.findIndex(b => b.id === id);
      const nb = [...bs]; const [m] = nb.splice(fi, 1); nb.splice(ti, 0, m); return nb;
    });
    dragFrom.current = null; setDragOver(null); markDirty();
  };

  /* ----- top-strip state ----- */
  const [status] = uS('Draft');
  const [locale, setLocale] = uS('EN');
  const [preview, setPreview] = uS(false);
  const [localeOpen, setLocaleOpen] = uS(false);

  const handleSetStaged = () => { addToast({ title: 'Staged to preview', blurb: 'northwind.site/preview/the-quiet-week', tone: 'accent', icon: 'eye' }); };

  return (
    <div className={`editor ${focusMode && typing ? 'is-focus' : ''} ${preview ? 'is-split' : ''}`} style={{ '--dim': dimAmount }}>
      <EditorTopStrip
        status={status} saved={saved} typing={typing} locale={locale} setLocale={setLocale}
        localeOpen={localeOpen} setLocaleOpen={setLocaleOpen}
        preview={preview} setPreview={setPreview} onBack={() => go('posts')}
        onStage={handleSetStaged} onOpenMeta={() => setMetaOpen(true)} metaOpen={metaOpen} />

      <div className="editor-stage">
        <div className="ed-scroll" onMouseDown={e => { if (e.target.classList.contains('ed-scroll') || e.target.classList.contains('ed-canvas')) setSelectedId(null); }}>
          <div className="ed-canvas" style={{ fontFamily: 'var(--font-canvas)' }}>
            <div className="ed-eyebrow">
              <Badge tone="neutral">Post</Badge>
              <span className="ed-eyebrow-sep">/</span>
              <span className="ed-breadcrumb">Drafts</span>
            </div>
            <Editable tag="h1" className="ed-title" blockId="__title" setRef={setRef}
              html={doc.title} placeholder="Untitled"
              onInput={e => { setDoc(d => ({ ...d, title: e.currentTarget.textContent })); markDirty(); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const f = blocks[0]; if (f && domRefs.current[f.id]) { domRefs.current[f.id].focus(); placeCaretStart(domRefs.current[f.id]); } } }}
              onFocus={() => { setActiveId('__title'); setSelectedId(null); }} />

            <div className="ed-blocks">
              {blocks.map((b, i) => (
                <BlockRow key={b.id} block={b} index={i} active={activeId === b.id} selected={selectedId === b.id}
                  hover={hoverId === b.id} dragOver={dragOver === b.id}
                  onHover={setHoverId} setRef={setRef}
                  onInput={onBlockInput} onKeyDown={onBlockKey}
                  onFocus={() => { setActiveId(b.id); if (b.type !== 'image' && b.type !== 'divider' && b.type !== 'dynamic') setSelectedId(null); }}
                  onSelect={() => setSelectedId(b.id)}
                  onAdd={() => { syncDom(); const nb = { id: nbid(), type: 'p', content: '' }; insertAfter(b.id, nb); setTimeout(() => openSlashFor(nb.id), 60); }}
                  onDragStart={onDragStart} onDragOver={onDragOverBlock} onDrop={onDrop}
                  updateBlock={updateBlock} removeBlock={removeBlock}
                  openProModal={openProModal} addToast={addToast} />
              ))}
            </div>

            <button className="ed-append" onClick={() => { syncDom(); const last = blocks[blocks.length - 1]; const nb = { id: nbid(), type: 'p', content: '' }; insertAfter(last.id, nb); }}>
              <Icon name="plus" size={15} /> Add a block, or press <Kbd>/</Kbd> anywhere
            </button>
          </div>

          {slash && (
            <SlashMenu items={slashFiltered} sel={slashSel} setSel={setSlashSel}
              top={slash.top} left={slash.left} onPick={applySlash} onClose={closeSlash} query={slash.query} />
          )}
        </div>

        {preview && <PreviewPane doc={doc} blocks={blocks} onClose={() => setPreview(false)} />}
      </div>
    </div>
  );
}

/* ---------------- Slash menu ---------------- */
function SlashMenu({ items, sel, setSel, top, left, onPick, onClose, query }) {
  const ref = uR(null);
  useClickAway(ref, onClose);
  uE(() => { const el = ref.current && ref.current.querySelector('.slash-item.sel'); if (el) el.scrollIntoView({ block: 'nearest' }); }, [sel]);
  return (
    <div className="slash" ref={ref} style={{ top, left }} role="listbox" aria-label="Insert block">
      <div className="slash-head">{query ? `Blocks matching “${query}”` : 'Basic blocks'}</div>
      <div className="slash-list">
        {items.length === 0 && <div className="slash-empty">No blocks found</div>}
        {items.map((it, i) => (
          <button key={it.type} role="option" aria-selected={i === sel}
            className={`slash-item ${i === sel ? 'sel' : ''}`}
            onMouseEnter={() => setSel(i)} onClick={() => onPick(it)}>
            <span className="slash-ic"><Icon name={it.icon} size={18} /></span>
            <span className="slash-text"><span className="slash-label">{it.label}{it.pro && <ProChip />}</span><span className="slash-desc">{it.desc}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* caret helpers */
function placeCaretEnd(el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function placeCaretStart(el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function caretIsAtEnd(el) { const s = getSelection(); if (!s.rangeCount) return false; const r = s.getRangeAt(0); const t = r.cloneRange(); t.selectNodeContents(el); t.setStart(r.endContainer, r.endOffset); return t.toString().length === 0; }
function caretIsAtStart(el) { const s = getSelection(); if (!s.rangeCount) return false; const r = s.getRangeAt(0); const t = r.cloneRange(); t.selectNodeContents(el); t.setEnd(r.startContainer, r.startOffset); return t.toString().length === 0; }

window.Editor = Editor;
window.editorHelpers = { SLASH_BLOCKS, nbid, placeCaretEnd };
