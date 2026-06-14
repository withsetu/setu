import '@testing-library/jest-dom/vitest'

// jsdom does not implement document.elementFromPoint — stub it so
// Tiptap v3's Placeholder viewport-tracking plugin does not throw.
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  document.elementFromPoint = () => null
}
