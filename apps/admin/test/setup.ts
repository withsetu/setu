import '@testing-library/jest-dom/vitest'
import { afterAll } from 'vitest'
import { disposeAuthSessionAtom } from './lib/session-atom'

// #495: dispose better-auth's session atom before vitest tears the jsdom environment down.
// Any suite that renders a component calling `authClient.useSession()` (AppSidebar -> UserMenu,
// SessionGate, …) without mocking the client mounts a nanostores store whose destroy runs on a
// 1000 ms Node timer that outlives `globalThis.window`; see test/lib/session-atom.ts for the full
// mechanism and the test that enforces it. Registered here rather than per-suite so a NEW test
// file cannot reintroduce the flake by forgetting it.
afterAll(disposeAuthSessionAtom)

// jsdom does not implement document.elementFromPoint — stub it so
// Tiptap v3's Placeholder viewport-tracking plugin does not throw.
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  document.elementFromPoint = () => null
}

// jsdom does not implement Range.getClientRects — stub it so ProseMirror's
// vertical-nav probe (endOfTextblock → singleRect, used by gapcursor on
// ArrowUp/ArrowDown) does not throw an async uncaught exception.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function () {
    return Object.assign([], { item: () => null })
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => ({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  }
}

// jsdom does not implement window.matchMedia — motion's useReducedMotion needs it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })
}
