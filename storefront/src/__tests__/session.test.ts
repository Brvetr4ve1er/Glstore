import { describe, expect, it } from 'vitest'
import { loginPath, safeNext } from '@/lib/session'

describe('safeNext — the post-login destination', () => {
  it.each([
    ['/account', '/account'],
    ['/apply/abc?step=2', '/apply/abc?step=2'],
  ])('keeps a same-site path %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected)
  })

  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ])('refuses %s (open redirect)', next => {
    expect(safeNext(next)).toBe('/account')
  })

  it('round-trips through loginPath', () => {
    const url = new URL(loginPath('/apply/x?step=3'), 'https://shop.test')
    expect(safeNext(url.searchParams.get('next'))).toBe('/apply/x?step=3')
  })
})
