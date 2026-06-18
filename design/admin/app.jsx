// app.jsx — root: context provider, routing, theme, tweaks
const { useState: uAS, useEffect: uAE, useCallback: uAC, useRef: uAR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#4f46e5",
  "canvasFont": "serif",
  "focusMode": "spotlight",
  "density": "regular",
  "radius": 10,
  "dark": false
}/*EDITMODE-END*/;

const ACCENTS = ['#4f46e5', '#0d9488', '#e0533d', '#2563eb', '#7c3aed', '#111827'];

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = uAS('editor');
  const [theme, setThemeState] = uAS(() => { try { return localStorage.getItem('setu-theme') || (tweaks.dark ? 'dark' : 'light'); } catch (e) { return 'light'; } });
  const [collapsed, setCollapsed] = uAS(false);
  const [cmdOpen, setCmdOpen] = uAS(false);
  const [metaOpen, setMetaOpen] = uAS(false);
  const [proModal, setProModal] = uAS(null);
  const [toasts, setToasts] = uAS([]);
  const [doc, setDoc] = uAS({ title: 'The quiet week before a launch', slug: 'the-quiet-week', blocks: null, metaDesc: '' });
  const toastId = uAR(0);

  const setTheme = uAC((t) => { setThemeState(t); try { localStorage.setItem('setu-theme', t); } catch (e) {} }, []);

  // apply theme + tweak vars
  uAE(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    const a = tweaks.accent || '#4f46e5';
    root.style.setProperty('--accent', theme === 'dark' ? `color-mix(in oklch, ${a}, white 18%)` : a);
    root.style.setProperty('--accent-strong', theme === 'dark' ? `color-mix(in oklch, ${a}, white 36%)` : `color-mix(in oklch, ${a}, black 12%)`);
    root.style.setProperty('--radius-base', (tweaks.radius || 10) + 'px');
    const dens = tweaks.density === 'compact' ? 0.85 : tweaks.density === 'comfy' ? 1.16 : 1;
    root.style.setProperty('--density', dens);
    root.style.setProperty('--font-canvas', tweaks.canvasFont === 'sans' ? 'var(--font-ui)' : 'var(--font-serif)');
  }, [theme, tweaks.accent, tweaks.radius, tweaks.density, tweaks.canvasFont]);

  const addToast = uAC((t) => {
    const id = ++toastId.current;
    setToasts(ts => [...ts, { ...t, id }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), t.duration || 4200);
  }, []);
  const dismissToast = uAC((id) => setToasts(ts => ts.filter(x => x.id !== id)), []);

  const go = uAC((r) => { setRoute(r); setCmdOpen(false); setMetaOpen(false); }, []);

  // global shortcuts
  uAE(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(o => !o); }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); setCollapsed(c => !c); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const ctx = {
    route, go, theme, setTheme, collapsed, setCollapsed,
    cmdOpen, setCmdOpen, openCmd: () => setCmdOpen(true),
    metaOpen, setMetaOpen,
    proModal, openProModal: (m) => setProModal(m), closeProModal: () => setProModal(null),
    toasts, addToast, dismissToast,
    doc, setDoc, tweaks, setTweak,
  };

  const isEditor = route === 'editor';

  return (
    <AppContext.Provider value={ctx}>
      <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <Sidebar />
        <main className="main">
          {route === 'dashboard' && <Dashboard />}
          {route === 'posts' && <ContentList kind="posts" />}
          {route === 'pages' && <ContentList kind="pages" />}
          {route === 'media' && <Media />}
          {route === 'forms' && <Forms />}
          {route === 'site' && <Site />}
          {route === 'settings' && <Settings />}
          {isEditor && <Editor />}
        </main>
      </div>
      {isEditor && <MetaPanel />}
      <CommandPalette />
      <ProModal />
      <ToastHost />
      <SetuTweaks tweaks={tweaks} setTweak={setTweak} theme={theme} setTheme={setTheme} />
    </AppContext.Provider>
  );
}

/* ============================================================
   TWEAKS PANEL
   ============================================================ */
function SetuTweaks({ tweaks, setTweak, theme, setTheme }) {
  return (
    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" value={theme} options={['light', 'dark']} onChange={(v) => setTheme(v)} />
      <TweakColor label="Accent" value={tweaks.accent} options={ACCENTS} onChange={(v) => setTweak('accent', v)} />

      <TweakSection label="Writing canvas" />
      <TweakRadio label="Reading face" value={tweaks.canvasFont} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }]} onChange={(v) => setTweak('canvasFont', v)} />
      <TweakRadio label="Focus mode" value={tweaks.focusMode} options={[{ value: 'spotlight', label: 'Spotlight' }, { value: 'dim', label: 'Dim' }, { value: 'off', label: 'Off' }]} onChange={(v) => setTweak('focusMode', v)} />

      <TweakSection label="Density & shape" />
      <TweakRadio label="Density" value={tweaks.density} options={[{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }, { value: 'comfy', label: 'Comfy' }]} onChange={(v) => setTweak('density', v)} />
      <TweakSlider label="Corner radius" value={tweaks.radius} min={4} max={18} step={1} unit="px" onChange={(v) => setTweak('radius', v)} />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
