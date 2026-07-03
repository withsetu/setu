import {
  variantFor,
  calloutVariants,
  CALLOUT_ICONS
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
