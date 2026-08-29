import { describe, it, expect } from 'vitest'
import {
  htmlToPlainText,
  stripComments,
  stripScriptStyle
} from '../../src/templating/fill-template'

/**
 * The evidence behind the two `js/incomplete-multi-character-sanitization` entries in
 * `.github/codeql-known-findings.json` (#1071).
 *
 * CodeQL is RIGHT about the parts and WRONG about the whole. Each stripper removes a span, so a
 * delimiter split across the removed span splices back together — that is a real property of
 * `stripComments` and `stripScriptStyle` taken alone, and the first two cases below pin it rather
 * than pretend otherwise. What makes the finding a false positive is the COMPOSITION: the
 * trailing `<[^<>]+>` strip in `htmlToPlainText` consumes the residue.
 *
 * This file exists so that rationale is enforced rather than merely written down. If the trailing
 * strip is ever removed or reordered, the third block fails and the allowlist entry stops being
 * true at the same moment — which is the whole point of the "name the test" rule (CLAUDE.md §3.2).
 * The allowlist note names this path.
 */

/** A `<!--` split so that removing the inner comment splices a new one. */
const SPLICED_COMMENT = '<!-<!-- -->- -->'
/** A `<script` split so that removing the inner element splices a new tag. */
const SPLICED_SCRIPT = '<scr<script>x</script>ipt>'

describe('the strippers alone CAN leave a spliced delimiter (CodeQL is right here)', () => {
  it('stripComments splices a new comment opener', () => {
    expect(stripComments(SPLICED_COMMENT)).toBe('<!-- -->')
  })

  it('stripScriptStyle splices a new script tag', () => {
    expect(stripScriptStyle(SPLICED_SCRIPT)).toBe('<script>')
  })
})

describe('htmlToPlainText removes the spliced delimiters CodeQL names', () => {
  it('drops the spliced script tag and keeps the text', () => {
    const out = htmlToPlainText(`${SPLICED_SCRIPT}alert(1)`)
    expect(out).toBe('alert(1)')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<')
  })

  it('drops the spliced comment opener', () => {
    const out = htmlToPlainText(`${SPLICED_COMMENT}hi`)
    expect(out).toBe('hi')
    expect(out).not.toContain('<!--')
    expect(out).not.toContain('<')
  })

  // The honest limit of the composition, pinned so the allowlist note cannot overstate it.
  //
  // The trailing `<[^<>]+>` strip is a SINGLE pass: removing a match can splice a new
  // angle-bracket run that the same pass has already scanned past. At two levels of nesting
  // `<scr<scr<script>a</script>ipt>b</script>ipt>tail` leaves the literal text `<scrbipt>tail`.
  //
  // That is inert and does not disturb the triage: the residue is not a `<script` (asserted), and
  // the destination is the email's text/plain part, where a stray `<…>` is characters rather than
  // markup. It IS the reason the allowlist rationale rests on the destination rather than on any
  // claim that this function sanitizes — it does not, and does not need to.
  it('can leave inert literal residue, but never a script tag', () => {
    const out = htmlToPlainText(
      '<scr<scr<script>a</script>ipt>b</script>ipt>tail'
    )
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<!--')
    // Documenting the actual output rather than asserting a cleanliness that is not delivered.
    expect(out).toBe('<scrbipt>tail')
  })
})
