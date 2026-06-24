export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/** Flip the theme, persist to [data-theme] + localStorage, return the new theme. */
export function toggleTheme(): 'light' | 'dark' {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  try { localStorage.setItem('setu-theme', next) } catch { /* private mode */ }
  return next
}
