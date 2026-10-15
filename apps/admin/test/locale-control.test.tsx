// #971: LocaleControl must not swallow a failed distinctLocales() — on failure it says the
// locales couldn't load (distinguishable from a genuinely single-locale site) and offers a
// retry, instead of rendering a picker identical to "this site has one locale".
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const distinctLocales = vi.fn<() => Promise<string[]>>()
// One stable service object, as the real IndexProvider hands out.
const service = { distinctLocales }
vi.mock('../src/data/index-store', () => ({
  useIndex: () => service
}))

const { LocaleControl } = await import('../src/editor/controls/locale')

const meta = { name: 'locale', apiBase: '', onPickMedia: () => {} }

afterEach(() => {
  cleanup()
  distinctLocales.mockReset()
})

describe('LocaleControl load failure (#971)', () => {
  it('shows an inline error with Retry when the index fails, and recovers on retry', async () => {
    distinctLocales.mockRejectedValueOnce(new Error('index down'))
    render(<LocaleControl value={undefined} onChange={() => {}} meta={meta} />)

    expect(
      await screen.findByText(/couldn.t load the site.s locales/i)
    ).toBeInTheDocument()
    const combo = screen.getByRole('combobox')
    expect(combo).toHaveAttribute('aria-invalid', 'true')
    expect(combo).toHaveAccessibleDescription(/couldn.t load/i)

    distinctLocales.mockResolvedValueOnce(['en', 'fr'])
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await vi.waitFor(() =>
      expect(screen.queryByText(/couldn.t load/i)).toBeNull()
    )
    expect(distinctLocales).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-invalid')
  })

  it('a genuinely single-locale site shows no error', async () => {
    distinctLocales.mockResolvedValue(['en'])
    render(<LocaleControl value={undefined} onChange={() => {}} meta={meta} />)
    await vi.waitFor(() => expect(distinctLocales).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByText(/couldn.t load/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  it('shows a loading hint distinct from both', () => {
    distinctLocales.mockReturnValue(new Promise(() => {}))
    render(<LocaleControl value={undefined} onChange={() => {}} meta={meta} />)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-busy', 'true')
  })
})
