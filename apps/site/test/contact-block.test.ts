import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// Real-build render coverage for the contact block (#448):
// content/page/en/contact-demo.mdoc renders blocks/contact/contact.astro →
// @setu/blocks ContactForm (a client:load island, so its full form markup is
// server-rendered into the static HTML). Reuses an existing dist/ like
// embed-block.test.ts. The #1248 endpoint assertions depend on the build having NO
// PUBLIC_SETU_API_BASE — true for the test/CI build; they are skipped when it is set.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string) =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let html = ''
beforeAll(() => {
  if (!existsSync(join(appDir, 'dist', 'page', 'contact-demo', 'index.html'))) {
    execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  }
  html = page('page/contact-demo')
}, 180_000)

describe('contact block render (#448)', () => {
  it('server-renders the form element with the block class', () => {
    expect(html).toMatch(/<form class="setu-contact"[^>]*>/)
  })

  it('renders accessible, label-associated fields (Name / Email / Message)', () => {
    // ContactForm.tsx: <label htmlFor={`setu-${formId}-${name}`}> + matching id
    // on each input — formId is "contact-demo" in the fixture.
    // label text + a decorative required marker (aria-hidden; aria-required carries it)
    const req = '<span class="setu-contact__req" aria-hidden="true"> \\*</span>'
    expect(html).toMatch(
      new RegExp(`<label for="setu-contact-demo-name">Name${req}</label>`)
    )
    expect(html).toMatch(/<input id="setu-contact-demo-name"[^>]*name="name"/)
    expect(html).toMatch(
      new RegExp(`<label for="setu-contact-demo-email">Email${req}</label>`)
    )
    expect(html).toMatch(
      /<input id="setu-contact-demo-email"[^>]*type="email"[^>]*name="email"/
    )
    expect(html).toMatch(
      new RegExp(`<label for="setu-contact-demo-message">Message${req}</label>`)
    )
    expect(html).toMatch(/<textarea id="setu-contact-demo-message"/)
    // subject defaults off — the optional field must not render uninvited
    expect(html).not.toContain('setu-contact-demo-subject')
  })

  it('renders the bot honeypot, and no empty captcha box when no site key is set', () => {
    // the test build sets no PUBLIC_CAPTCHA_SITE_KEY: nothing to mount, so no stray div
    expect(html).not.toContain('class="setu-contact__captcha"')
    // honeypot is visually hidden from AT and out of the tab order
    expect(html).toMatch(
      /class="setu-contact__hp" aria-hidden="true"[\s\S]*?<input[^>]*tabindex="-1"[^>]*name="setu_hp_k7"/
    )
    // the old semantic trap name autofill filled for real visitors is gone (#1248)
    expect(html).not.toContain('name="company"')
  })

  it('renders the submit button', () => {
    expect(html).toMatch(/<button type="submit"[^>]*>Send<\/button>/)
  })

  it('renders author-supplied visitor text from the contract props (#1248)', () => {
    expect(html).toMatch(/<label for="setu-contact-demo-fr-name">Nom</)
    expect(html).toMatch(/<label for="setu-contact-demo-fr-email">Courriel</)
    expect(html).toMatch(
      /<label for="setu-contact-demo-fr-message">Votre message</
    )
    expect(html).toMatch(/<button type="submit"[^>]*>Envoyer<\/button>/)
  })

  // #1248: a production build with no API endpoint must not bake the dev localhost into
  // the island, and must say the form is unavailable instead of failing on submit.
  const endpointConfigured = Boolean(process.env.PUBLIC_SETU_API_BASE)
  it.skipIf(endpointConfigured)(
    'without PUBLIC_SETU_API_BASE: no localhost endpoint, an honest unavailable state',
    () => {
      expect(html).not.toContain('localhost:4444')
      expect(html).toContain('This form isn&#x27;t available right now.')
      expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Send</)
    }
  )

  it('hydrates as an island — interactive blocks are the JS-for-dreamers exception', () => {
    expect(html).toContain('<astro-island')
  })
})
