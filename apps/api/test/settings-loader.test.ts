import { describe, expect, it } from 'vitest'
import { createSettingsLoader } from '../src/settings-loader'

/**
 * #937: the api used the warnings-FREE `parseSettings`, so every reason the salvage layer had
 * for resetting a stored key was discarded — at boot and on every per-send read. apps/site made
 * the opposite call deliberately (#656: a silently-reset key "silently changes what the site
 * publishes"). This is that decision brought over, with the one thing the site build does not
 * need: the api re-reads settings.json per email/per request (#939), so an unconditional log
 * would print the same complaint once per message.
 */
function loaderOver(files: { current: string }) {
  const logged: string[][] = []
  const load = createSettingsLoader({
    read: () => files.current,
    onWarnings: (w) => logged.push(w)
  })
  return { load, logged }
}

const OVERSIZED = JSON.stringify({
  email: { templates: { 'not a valid id': { subject: 'x' } } }
})

describe('createSettingsLoader (#937)', () => {
  it('parses like parseSettings did — a malformed file still yields defaults, never throws', () => {
    const files = { current: '{ not json' }
    const { load, logged } = loaderOver(files)
    expect(load().general.title).toBe('Setu')
    // Unreadable is not the same as "a stored key was reset": there is nothing to name.
    expect(logged).toEqual([])
  })

  it('reports the salvage warnings the api used to discard', () => {
    const { load, logged } = loaderOver({ current: OVERSIZED })
    load()
    expect(logged).toHaveLength(1)
    expect(logged[0]?.join('\n')).toContain('email.templates')
  })

  it('a clean file logs nothing', () => {
    const { load, logged } = loaderOver({
      current: JSON.stringify({ general: { title: 'Fine' } })
    })
    load()
    load()
    expect(logged).toEqual([])
  })

  // THE reason this is a loader and not a bare `for (const w of warnings) console.warn(w)`:
  // #939 means one email costs several settings reads, and a form submission is a
  // visitor-triggered path. Unconditional logging would turn one bad stored template into a
  // per-message log flood.
  it('logs ONCE for an unchanged problem, however many times it is read', () => {
    const { load, logged } = loaderOver({ current: OVERSIZED })
    load()
    load()
    load()
    expect(logged).toHaveLength(1)
  })

  it('logs again when the warning set CHANGES', () => {
    const files = { current: OVERSIZED }
    const { load, logged } = loaderOver(files)
    load()
    files.current = JSON.stringify({
      email: { templates: { 'not a valid id': { subject: 'x' } } },
      permalinks: { uncategorized: 'NOT A SLUG' }
    })
    load()
    expect(logged).toHaveLength(2)
    // The WHOLE set, not the delta: an operator reading the second report must not have to
    // reconstruct it from the first. Asserting only the new warning would pass against a
    // delta-only reporter.
    expect(logged[1]?.join('\n')).toContain('permalinks.uncategorized')
    expect(logged[1]?.join('\n')).toContain('email.templates')
  })

  // The guard key must be ambiguity-free. Warning strings embed raw settings.json keys VERBATIM,
  // so a key containing a newline can make two genuinely different warning sets join to the same
  // string — and under a joined guard key the second set would be silenced entirely. The id below
  // is crafted to do exactly that against {"A", "B"}; the assertions prove both halves, that the
  // collision is real and that the loader still reports both.
  it('two warning sets that a joined key would confuse are told apart', () => {
    const NOT_AN_ID =
      ': not a valid email type id — dropped, using the shipped default'
    const colliding = `A${NOT_AN_ID}\nemail.templates.B`
    const files = {
      current: JSON.stringify({ email: { templates: { [colliding]: {} } } })
    }
    const { load, logged } = loaderOver(files)
    load()
    files.current = JSON.stringify({ email: { templates: { A: {}, B: {} } } })
    load()
    // The hazard, demonstrated: one warning and two warnings, indistinguishable once joined.
    expect(logged[0]?.join('\n')).toBe(logged[1]?.join('\n'))
    expect(logged[0]).toHaveLength(1)
    expect(logged[1]).toHaveLength(2)
    // …and reported anyway.
    expect(logged).toHaveLength(2)
  })

  it('goes quiet when the file is fixed, and speaks again if it breaks a second time', () => {
    const files = { current: OVERSIZED }
    const { load, logged } = loaderOver(files)
    load()
    files.current = JSON.stringify({ general: { title: 'Fixed' } })
    load()
    expect(logged).toHaveLength(1)
    files.current = OVERSIZED
    load()
    expect(logged).toHaveLength(2)
  })

  // The comparison is over the SET, not the emitted order: the same complaints arriving in a
  // different order are the same problem and must not re-log.
  it('re-ordered identical warnings are not a change', () => {
    const files = {
      current: JSON.stringify({
        media: { imageFormat: 'nope' },
        permalinks: { uncategorized: 'NOT A SLUG' }
      })
    }
    const { load, logged } = loaderOver(files)
    load()
    files.current = JSON.stringify({
      permalinks: { uncategorized: 'NOT A SLUG' },
      media: { imageFormat: 'nope' }
    })
    load()
    expect(logged).toHaveLength(1)
  })
})
