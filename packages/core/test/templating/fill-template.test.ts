import { describe, expect, it } from 'vitest'
import {
  fillTemplate,
  escapeHtml,
  htmlToPlainText,
  HTML_TO_TEXT_MAX_INPUT,
  stripComments,
  stripScriptStyle,
  tokenNamesIn,
  unknownTokensIn,
  type TokenSpec
} from '../../src/templating/fill-template'
import { resolveSeo } from '../../src/seo/resolve-seo'
import { DEFAULT_SETTINGS } from '../../src/settings/defaults'
import { renderEmailTemplate } from '../../src/email/template-registry'
import { PASSWORD_RESET_EMAIL } from '../../src/email/templates/password-reset'

// #499 (epic #497): the ONE {{token}} engine. Promoted out of seo/resolve-seo.ts so email
// templates, SEO titles and every future templated string share one syntax, one escaping
// policy and one unknown-token rule.

const vocab: TokenSpec[] = [
  { name: 'name', description: 'The recipient name' },
  { name: 'link', description: 'A server-generated URL', rawHtml: true },
  { name: 'rows', description: 'Pre-rendered rows', rawHtml: true }
]

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('fillTemplate — substitution', () => {
  // `context` is required (#936); these cases are about the grammar, not the escaping policy,
  // so they all state the text context explicitly.
  const text = { context: 'text' } as const

  it('substitutes a known token', () => {
    expect(fillTemplate('Hi {{name}}!', { name: 'Ada' }, text)).toBe('Hi Ada!')
  })

  it('tolerates inner whitespace in the token', () => {
    expect(fillTemplate('Hi {{  name  }}!', { name: 'Ada' }, text)).toBe(
      'Hi Ada!'
    )
  })

  it('substitutes the same token everywhere it appears', () => {
    expect(fillTemplate('{{name}}/{{name}}', { name: 'x' }, text)).toBe('x/x')
  })

  // The documented unknown-token rule: STRIP. Same behavior the promoted SEO helper always
  // had, so one rule covers every context — and a recipient never sees `{{oops}}` in their
  // inbox. The editor warns about unknown tokens at authoring time instead (unknownTokensIn).
  it('strips an unknown token rather than leaving it literal', () => {
    expect(fillTemplate('Hi {{nope}}!', { name: 'Ada' }, text)).toBe('Hi !')
  })

  it('strips a known token whose value is absent or undefined', () => {
    expect(fillTemplate('[{{name}}]', {}, text)).toBe('[]')
    expect(fillTemplate('[{{name}}]', { name: undefined }, text)).toBe('[]')
  })

  // Only `{{word}}` is a token. Anything else — including an attempt to smuggle a VALUE into
  // the template — is not matched, which is the structural reason a template can never supply
  // its own reset URL (see email-registry.test.ts's reset-URL integrity test).
  it('leaves non-token braces alone', () => {
    expect(fillTemplate('{{reset_url=http://evil}}', {}, text)).toBe(
      '{{reset_url=http://evil}}'
    )
    expect(fillTemplate('{{a-b}} {single} {{ }}', {}, text)).toBe(
      '{{a-b}} {single} {{ }}'
    )
  })

  it('does not re-scan a substituted value for tokens', () => {
    expect(
      fillTemplate('{{name}}', { name: '{{link}}', link: 'X' }, text)
    ).toBe('{{link}}')
  })
})

describe('fillTemplate — escaping', () => {
  it('html context escapes substituted values by default', () => {
    expect(
      fillTemplate(
        '<p>{{name}}</p>',
        { name: '<script>x</script>' },
        {
          context: 'html',
          vocabulary: vocab
        }
      )
    ).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>')
  })

  it('html context inserts a rawHtml token verbatim', () => {
    expect(
      fillTemplate(
        '<a href="{{link}}">go</a>',
        { link: 'https://x/?a=1&b=2' },
        {
          context: 'html',
          vocabulary: vocab
        }
      )
    ).toBe('<a href="https://x/?a=1&b=2">go</a>')
  })

  // rawHtml is a property of the VOCABULARY (core code), never of the template text: with no
  // vocabulary nothing is raw, so a template author has no way to opt a value out of escaping.
  it('escapes a rawHtml-named token when the vocabulary does not declare it', () => {
    expect(
      fillTemplate('<p>{{link}}</p>', { link: '<b>x</b>' }, { context: 'html' })
    ).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>')
  })

  it('text context substitutes verbatim (no HTML context to break)', () => {
    expect(
      fillTemplate('{{name}}', { name: 'a & b <c>' }, { context: 'text' })
    ).toBe('a & b <c>')
  })

  it('a per-part value supplies html and text separately', () => {
    const values = { rows: { html: '<tr><td>a</td></tr>', text: 'a' } }
    expect(
      fillTemplate('<table>{{rows}}</table>', values, {
        context: 'html',
        vocabulary: vocab
      })
    ).toBe('<table><tr><td>a</td></tr></table>')
    expect(fillTemplate('{{rows}}', values, { context: 'text' })).toBe('a')
  })

  it('escapes the html half of a per-part value when the token is not rawHtml', () => {
    expect(
      fillTemplate(
        '{{name}}',
        { name: { html: '<b>', text: 'b' } },
        {
          context: 'html',
          vocabulary: vocab
        }
      )
    ).toBe('&lt;b&gt;')
  })
})

describe('fillTemplate — singleLine', () => {
  it('collapses whitespace runs and trims', () => {
    expect(
      fillTemplate(
        '  {{a}}   {{b}}  ',
        { a: 'x', b: 'y' },
        {
          context: 'text',
          singleLine: true
        }
      )
    ).toBe('x y')
  })

  // Header-injection floor: an email SUBJECT is a header, so CR/LF must never survive — not
  // from the template and not from a substituted value.
  it('removes CR/LF from the template and from substituted values', () => {
    expect(
      fillTemplate(
        'Re: {{a}}\r\nBcc: evil@x',
        { a: 'b\nc' },
        {
          context: 'text',
          singleLine: true
        }
      )
    ).toBe('Re: b c Bcc: evil@x')
  })

  it('is off by default so a text body keeps its line breaks', () => {
    expect(fillTemplate('a\n\nb {{t}}', { t: 'c' }, { context: 'text' })).toBe(
      'a\n\nb c'
    )
  })
})

// #936. `context` used to be optional and defaulted to `'text'` — the NON-escaping mode — so a
// future HTML caller that forgot it got verbatim substitution with no type error, no lint signal
// and no runtime symptom until a value carried markup. The fix is the SIGNATURE, not a new
// default: flipping the default to `'html'` would have entity-escaped SEO titles instead.
describe('fillTemplate — context is required (#936)', () => {
  // KILL-SHOT TARGET. Make `context` optional again (or restore `opts: FillOptions = {}`) and
  // this @ts-expect-error goes unused, which is itself a compile error (TS2578) — so
  // `pnpm --filter @setu/core typecheck` fails. This assertion lives in the type checker
  // because that is the only place the defect was ever observable.
  it('is a compile error to omit the context', () => {
    const withoutContext = () =>
      // @ts-expect-error context is a required member of FillOptions
      fillTemplate('Hi {{name}}!', { name: 'Ada' }, {})
    const withoutOptions = () =>
      // @ts-expect-error the whole options object is required too
      fillTemplate('Hi {{name}}!', { name: 'Ada' })
    // Neither closure is INVOKED — the assertion is the pair of directives above, and it is the
    // typechecker that makes it. Calling them would only prove what the old default did.
    expect(
      [withoutContext, withoutOptions].every((f) => typeof f === 'function')
    ).toBe(true)
  })

  // The two production callers, byte-for-byte. `context` moving into the signature must not move
  // a single character of what a reader sees: an SEO <title> stays unescaped (this is why the
  // default was NOT flipped to 'html'), and an email subject stays unescaped and single-line.
  it('leaves the SEO title caller byte-identical', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      general: { ...DEFAULT_SETTINGS.general, title: 'Ada & Co' },
      identity: {
        ...DEFAULT_SETTINGS.identity,
        titleTemplate: '{{title}} {{separator}} {{site}}'
      }
    }
    expect(
      resolveSeo(settings, {
        title: 'Tea & <b>crumpets</b>',
        canonical: 'https://x.test/tea'
      }).title
    ).toBe('Tea & <b>crumpets</b> · Ada & Co')
  })

  it('leaves the email subject caller byte-identical', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: 'Reset for {{user_name}}' },
      { reset_url: 'https://x/reset', user_name: 'Ada & Co' }
    )
    expect(out.subject).toBe('Reset for Ada & Co')
  })
})

describe('tokenNamesIn / unknownTokensIn', () => {
  it('lists the tokens a template uses, de-duplicated and in order', () => {
    expect(tokenNamesIn('{{b}} {{a}} {{ b }}')).toEqual(['b', 'a'])
  })

  it('reports only the tokens outside the vocabulary, de-duplicated', () => {
    expect(unknownTokensIn('{{name}} {{oops}} {{oops}}', vocab)).toEqual([
      'oops'
    ])
  })

  it('reports nothing for a template with no tokens', () => {
    expect(unknownTokensIn('plain text', vocab)).toEqual([])
  })
})

describe('htmlToPlainText', () => {
  it('drops tags, keeps block structure, and decodes entities', () => {
    expect(
      htmlToPlainText('<h2>Hi &amp; bye</h2><p>one</p><p>two<br>three</p>')
    ).toBe('Hi & bye\n\none\n\ntwo\nthree')
  })

  it('renders a link as its text followed by the URL', () => {
    expect(htmlToPlainText('<p><a href="https://x/y">Click</a></p>')).toBe(
      'Click (https://x/y)'
    )
  })

  it('drops script and style content entirely', () => {
    expect(
      htmlToPlainText(
        '<style>p{color:red}</style><p>keep</p><script>x()</script>'
      )
    ).toBe('keep')
  })

  it('turns table rows into lines and cells into separated text', () => {
    expect(
      htmlToPlainText('<table><tr><td>name</td><td>Ada</td></tr></table>')
    ).toBe('name: Ada')
  })

  it('collapses runaway blank lines', () => {
    expect(htmlToPlainText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb')
  })

  // The label may carry inline markup — `<a href="…"><strong>Reset</strong></a>` is ordinary
  // HTML-email shape — and the URL has to survive it, because in a password-reset body the URL
  // is the only actionable thing in the message. Pins the decision NOT to flatten the label to
  // `[^<]*` when #941 bounded this function.
  it('keeps the URL of a link whose label carries inline markup', () => {
    expect(
      htmlToPlainText('<p><a href="https://x/y"><strong>Click</strong></a></p>')
    ).toBe('Click (https://x/y)')
  })

  // The other side of that decision: the label run is BOUNDED (`{0,4000}?`), so past the bound an
  // anchor stops being recognised as one — its text survives, its URL does not. Asserted so the
  // concession is pinned rather than discovered. No shipped template comes near 4000 characters
  // of label.
  it('drops the URL of a link whose label exceeds the label bound', () => {
    const out = htmlToPlainText(
      `<p><a href="https://x/y">${'L'.repeat(4001)}</a></p>`
    )
    expect(out).toBe('L'.repeat(4001))
    expect(out).not.toContain('https://x/y')
  })

  // #941 replaced two lazy regex spans with hand-written forward walks. These two blocks are the
  // OUTPUT half of that change — the timing tests below are the bound half, and neither implies
  // the other. They were written because nothing in the suite exercised them: no input anywhere
  // contained an HTML comment, so changing stripComments' `close + 3` to `close + 2` (turning
  // `a<!--b-->c` into `a>c`) passed all 1439 core tests. Every expectation here was taken from the
  // pre-#941 implementation, so they assert equivalence rather than intent.
  describe('removes comment spans exactly as the pattern it replaced did', () => {
    it.each([
      ['a plain comment', '<p>keep<!-- secret -->this</p>', 'keepthis'],
      // Lazy: the FIRST `-->` closes, so an inner `<!--` is just text inside the span.
      ['a nested opener', '<p>a<!--b<!--c-->d</p>', 'ad'],
      // Unterminated: left alone, exactly as the non-matching regex left it.
      ['an unterminated comment', '<p>a<!--b</p>', 'a<!--b'],
      ['an empty comment', '<!---->', ''],
      // `<!-->` is NOT a comment (no closing `-->`); it falls through to the tag strip.
      ['the <!--> shape', '<p>x<!-->y</p>', 'xy'],
      [
        'consecutive comments',
        '<p>one<!--c1-->two<!--c2-->three</p>',
        'onetwothree'
      ]
    ])('%s', (_name, input, expected) => {
      expect(htmlToPlainText(input)).toBe(expected)
    })
  })

  /**
   * The general half of the equivalence claim, which no enumeration can carry.
   *
   * The oracles below are the #941-TIGHTENED patterns — attribute runs already `[^<>]` — i.e.
   * exactly the shapes the two walks replaced, and NOT the pre-#941 `[^>]` ones that were the
   * actual defect. Their only remaining flaw is the O(unclosed spans x input) lazy scan, which at
   * the <=200-character inputs used here is microseconds. Nothing exploitable is embedded, and the
   * REFERENCE_ONLY_ prefix plus this comment are the guard against anyone copying them back into
   * src/.
   *
   * This exists because the enumerated tables above PROVABLY missed a real deviation: deleting
   * `open.lastIndex = cursor` from stripScriptStyle survives every enumerated case and the whole
   * file, while diverging from the oracle on ~0.9% of random inputs — 82% of those divergences are
   * masked end to end by the later tag strip. A differential run once during development would not
   * help either: per CLAUDE.md §3.3 #4, a check that fires zero times against the NEXT change
   * reads as coverage without being any. The seed is fixed so a failure reproduces exactly.
   */
  describe('the span walks agree with the patterns they replaced', () => {
    const REFERENCE_ONLY_pre941Comment = (s: string): string =>
      s.replace(/<!--[\s\S]*?-->/g, '')
    const REFERENCE_ONLY_pre941Span = (s: string): string =>
      s.replace(/<(script|style)\b[^<>]*>[\s\S]*?<\/\1>/gi, '')

    // Deterministic PRNG (mulberry32) — a differential that shuffles per run is a flaky test, and
    // a failure nobody can reproduce is not evidence.
    const seeded = (seed: number) => (): number => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    // Atoms chosen so openers, closers, mismatched closers, case variants and the surrounding
    // markup collide densely at short lengths — the region where the walks' cursor arithmetic and
    // the patterns' backtracking can disagree.
    const ATOMS = [
      '<!--',
      '-->',
      '<script>',
      '</script>',
      '<style>',
      '</style>',
      '<SCRIPT >',
      '</SCRIPT>',
      '<scriptx>',
      '<p>',
      '</p>',
      '<',
      '>',
      '\n',
      'a',
      'KEEP'
    ]
    const corpus = (seed: number, count: number): string[] => {
      const rand = seeded(seed)
      return Array.from({ length: count }, () => {
        let s = ''
        const n = 1 + Math.floor(rand() * 12)
        for (let i = 0; i < n; i += 1)
          s += ATOMS[Math.floor(rand() * ATOMS.length)] as string
        return s.slice(0, 200)
      })
    }

    it('agrees with the pattern it replaced on 2,000 random inputs', () => {
      for (const input of corpus(0x5e7c, 2_000))
        expect(stripComments(input), JSON.stringify(input)).toBe(
          REFERENCE_ONLY_pre941Comment(input)
        )
    })

    // KILL-SHOT TARGET for stripScriptStyle's cursor arithmetic, including the
    // `open.lastIndex = cursor` line that the enumerated table cannot reach.
    it('agrees with the span pattern it replaced on 2,000 random inputs', () => {
      for (const input of corpus(0x9a3f, 2_000))
        expect(stripScriptStyle(input), JSON.stringify(input)).toBe(
          REFERENCE_ONLY_pre941Span(input)
        )
    })
  })

  describe('removes script and style spans exactly as the pattern it replaced did', () => {
    it.each([
      ['a script span', '<script>a()</script>b', 'b'],
      [
        'a style span, case-insensitively',
        '<STYLE>p{color:red}</STYLE>keep',
        'keep'
      ],
      // The tag-name backreference: `<script>` is not closed by `</style>`, so neither is a span
      // and both are stripped as bare tags.
      ['a mismatched closer', '<p><script>a</style>b</p>', 'ab'],
      // An unclosed <script> must not swallow the well-formed <style> span that follows it.
      [
        'an unclosed script before a closed style',
        '<p><script>x<style>y</style>z</p>',
        'xz'
      ],
      ['a closer in a different case', '<script>a</SCRIPT>b', 'b']
    ])('%s', (_name, input, expected) => {
      expect(htmlToPlainText(input)).toBe(expected)
    })
  })
})

/**
 * #941 — this function is the only unbounded-duration step left on the anonymous
 * `/forms/submit` → notification-email path (the same class as #340, #928).
 *
 * `renderEmailTemplate` calls it on every send whose HTML body was overridden, and the 20 KB
 * template cap does NOT bound its input: the input is the RENDERED body, which carries visitor
 * field content and grows again when that content is HTML-escaped.
 *
 * Four bounds, each measured at the 100 KB ceiling on this machine. THREE of them are what makes
 * the wall-clock assertion below pass; the fourth is insurance and is honestly labelled as such:
 *
 * - the input CEILING itself;
 * - every tag-internal run tightened from `[^>]` to `[^<>]`. This was by far the largest term:
 *   `'<a href="x'` repeated to 100 KB took ~22 MINUTES with the old patterns, scaling cubically
 *   (2.7 ms at 1 KB, 90 ms at 4 KB, 5.4 s at 16 KB), and takes ~1 ms now;
 * - the two lazy SPAN scans (`<!-- … -->`, `<script|style> … </>`) replaced by forward walks:
 *   ~470 ms -> ~1 ms and ~100 ms -> ~2 ms respectively on 100 KB of unclosed openers;
 * - the anchor LABEL run bounded to `{0,4000}?`, which COSTS ~7 ms today (`*?` measures ~33 ms
 *   against the bound's ~41 ms, best-of-7 in isolation: V8 turns an unbounded lazy run followed
 *   by a literal into a memchr-style scan, while a counted quantifier is a per-character loop).
 *   It is kept because it decouples the label's cost from HTML_TO_TEXT_MAX_INPUT rather than
 *   because it is faster — see the note on htmlToPlainText. No assertion in this block bites for
 *   it; the two output tests above are what pin it.
 */
describe('htmlToPlainText is bounded (#941)', () => {
  it('truncates input past the hard ceiling', () => {
    const out = htmlToPlainText(
      `<p>head</p>${'x'.repeat(HTML_TO_TEXT_MAX_INPUT)}<p>tail</p>`
    )
    expect(out.startsWith('head')).toBe(true)
    expect(out).not.toContain('tail')
    expect(out.length).toBeLessThanOrEqual(HTML_TO_TEXT_MAX_INPUT)
  })

  // KILL-SHOT TARGET. Restore any of the old `[^>]` attribute runs (or drop the ceiling) and the
  // first input alone blows past this bound — with the pre-#941 patterns it took ~3.9 s, and the
  // unterminated-quote input ~5.4 s at the 16 KB used here.
  //
  // Deliberately a BOUND, not a curve: the whole corpus measures 56-71 ms in this suite, so 3 s
  // leaves more than an order of magnitude of headroom and cannot flake on a loaded CI runner,
  // while still failing loudly the moment a superlinear pattern comes back. The largest single
  // contributor is the stray-`</a>` input at ~56 ms, which is the label run — slightly DEARER
  // than it would be unbounded (see the block comment above); reverting the label bound leaves
  // this corpus at ~48 ms and green. Every other input is under 10 ms.
  it('finishes pathological markup inside a generous wall-clock bound', () => {
    const pad = (s: string, n = HTML_TO_TEXT_MAX_INPUT): string =>
      s.length >= n ? s.slice(0, n) : s + 'y'.repeat(n - s.length)
    const inputs = [
      // An attribute run that never reaches its `>`.
      pad('<a'.repeat(HTML_TO_TEXT_MAX_INPUT / 2)),
      // An href quote that is never closed — the cubic case, at 16 KB.
      pad('<a href="x'.repeat(1600), 16_000),
      // The shape the issue named: k unclosed anchors over a large payload.
      pad('<a href="https://x/">'.repeat(1500)),
      // A stray `</a>` up front, so no engine-level "the closer is absent" shortcut applies.
      pad('</a>' + '<a href="x">'.repeat(HTML_TO_TEXT_MAX_INPUT / 12)),
      // Unclosed comments and unclosed <script>, the other two lazy spans in the chain.
      pad('<!--'.repeat(HTML_TO_TEXT_MAX_INPUT / 4)),
      pad('-->' + '<!--'.repeat(HTML_TO_TEXT_MAX_INPUT / 4)),
      pad('<script>'.repeat(HTML_TO_TEXT_MAX_INPUT / 8)),
      pad("<a href=\"x<a href='y'></a><script>".repeat(2900))
    ]
    const started = Date.now()
    for (const input of inputs) htmlToPlainText(input)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  // KILL-SHOT TARGET for the comment scan specifically: `/<!--[\s\S]*?-->/g` back in place of
  // stripComments takes this input from ~1 ms to ~240-470 ms. It needs its own assertion because
  // the corpus bound above is wide enough to absorb that regression on its own — a bound generous
  // enough not to flake is too generous to catch a several-fold regression in one of its steps.
  //
  // The bound is 50 ms, not 200: at 200 the mutant's slowest observed run (242 ms) cleared the
  // bound by only 1.2x, which is thin enough that a fast machine could let the regression through.
  // 50 ms keeps ~50x headroom over the ~1 ms this actually takes while putting the mutant ~5x
  // outside — the same shape as the script-span bound below.
  it('drops unclosed comments in one pass, not one per comment', () => {
    const started = Date.now()
    htmlToPlainText('<!--'.repeat(HTML_TO_TEXT_MAX_INPUT / 4))
    expect(Date.now() - started).toBeLessThan(50)
  })

  // Same reasoning, same shape, for the other lazy span: the pattern takes this input to ~100 ms,
  // the walk to ~2 ms.
  it('drops unclosed script spans in one pass, not one per span', () => {
    const started = Date.now()
    htmlToPlainText('<script>'.repeat(HTML_TO_TEXT_MAX_INPUT / 8))
    expect(Date.now() - started).toBeLessThan(50)
  })
})
