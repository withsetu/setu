/**
 * #1252 — Markdoc's tag grammar reads a number only as `-?[0-9]+(.[0-9]+)?`
 * (@markdoc/markdoc src/grammar/tag.pegjs, `ValueNumber`), but `Markdoc.format` writes
 * numbers with `JSON.stringify`, which uses exponent notation outside 1e-7 < |n| < 1e21
 * (`1e+21`, `1e-7`). A block holding such a value was written in a spelling its own
 * parser rejects, and reopened as an "Unparsed Markdoc" passthrough.
 *
 * `plainDecimal` re-spells a number in plain decimal by moving the decimal point of
 * JavaScript's shortest round-trip spelling, so the digits — and therefore the value
 * `Number()` reads back — are unchanged. Enforced by
 * `packages/core/test/exponent-number-roundtrip.test.ts`.
 */
export function plainDecimal(n: number): string {
  const spelled = String(n)
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(spelled)
  if (!m) return spelled
  const [, sign = '', int = '', frac = '', exp = '0'] = m
  const digits = int + frac
  // Where the decimal point falls within `digits` once the exponent is applied.
  const point = int.length + Number(exp)
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length)
    return `${sign}${digits}${'0'.repeat(point - digits.length)}`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

/** True when `n` is finite and `String(n)` would spell it in exponent notation. */
export const needsPlainSpelling = (n: number): boolean =>
  Number.isFinite(n) && /e/i.test(String(n))
