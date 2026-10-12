import {
  variantFor,
  calloutVariants,
  CALLOUT_ICONS,
  calloutIcon
} from '../src/callout/variants'

test('variantFor maps a known type to tone + icon', () => {
  expect(variantFor('warning')).toEqual({
    type: 'warning',
    label: 'Warning',
    tone: 'amber',
    icon: 'alert'
  })
})

test('variantFor neutral-fallbacks an unknown type (keeps the raw type)', () => {
  const v = variantFor('mystery')
  expect(v.type).toBe('mystery')
  expect(v.tone).toBe('neutral')
  expect(v.icon).toBe('sparkle')
})

test('calloutVariants reflects the default config variant list', () => {
  expect(calloutVariants().map((v) => v.type)).toEqual([
    'info',
    'note',
    'success',
    'warning',
    'danger',
    'neutral'
  ])
})

test('CALLOUT_ICONS is the curated picker set', () => {
  expect(CALLOUT_ICONS).toEqual([
    'info',
    'check',
    'alert',
    'sparkle',
    'zap',
    'pin',
    'lock',
    'settings'
  ])
})

// #1247: one rule for the callout's icon, shared by the editor canvas and the site renderer.
describe('calloutIcon', () => {
  it('uses a valid override, else the tone default', () => {
    expect(calloutIcon('info', 'lock')).toBe('lock')
    expect(calloutIcon('warning', undefined)).toBe('alert')
    expect(calloutIcon('warning', '')).toBe('alert')
    expect(calloutIcon('success', 'not-an-icon')).toBe('check')
    expect(calloutIcon('info', 42)).toBe('info')
  })
})
