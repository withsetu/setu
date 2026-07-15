import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// Real-build render coverage for the contact block (#448):
// content/page/en/contact-demo.mdoc renders blocks/contact/contact.astro →
// @setu/blocks ContactForm (a client:load island, so its full form markup is
// server-rendered into the static HTML). Reuses an existing dist/ like
// embed-block.test.ts — none of these assertions depend on build-time env.

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
    expect(html).toContain('<label for="setu-contact-demo-name">Name</label>')
    expect(html).toMatch(/<input id="setu-contact-demo-name"[^>]*name="name"/)
    expect(html).toContain('<label for="setu-contact-demo-email">Email</label>')
    expect(html).toMatch(
      /<input id="setu-contact-demo-email"[^>]*type="email"[^>]*name="email"/
    )
    expect(html).toContain(
      '<label for="setu-contact-demo-message">Message</label>'
    )
    expect(html).toMatch(/<textarea id="setu-contact-demo-message"/)
    // subject defaults off — the optional field must not render uninvited
    expect(html).not.toContain('setu-contact-demo-subject')
  })

  it('renders the captcha mount point and the bot honeypot', () => {
    expect(html).toContain('class="setu-contact__captcha"')
    // honeypot is visually hidden from AT and out of the tab order
    expect(html).toMatch(
      /class="setu-contact__hp" aria-hidden="true"[\s\S]*?<input[^>]*tabindex="-1"[^>]*name="company"/
    )
  })

  it('renders the submit button', () => {
    expect(html).toMatch(/<button type="submit"[^>]*>Send<\/button>/)
  })

  it('hydrates as an island — interactive blocks are the JS-for-dreamers exception', () => {
    expect(html).toContain('<astro-island')
  })
})
