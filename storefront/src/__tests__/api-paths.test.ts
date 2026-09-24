/**
 * Route params reach API paths. Undecoded, a link like
 * /apply/..%2F..%2Fauth%2Fcustomer%2Flogout would walk the request —
 * carrying the shopper's session token — to a different endpoint.
 * Every id must arrive as exactly one path segment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMyApplication, fetchMyOrder, fetchProduct, submitApplication } from '@/lib/api'

let calls: string[] = []

beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function pathOf(url: string): string {
  return new URL(url, 'https://shop.test').pathname
}

describe('ids in API paths', () => {
  it.each([
    ['../../auth/customer/logout'],
    ['..%2F..%2Fauth'],
    ['a/b'],
  ])('keeps %s inside its own segment', async hostile => {
    await submitApplication(hostile)
    const path = pathOf(calls[0])
    expect(path.startsWith('/api/v1/financing/applications/')).toBe(true)
    expect(path.endsWith('/submit')).toBe(true)
    // Exactly one segment between the collection and the action.
    const middle = path.slice('/api/v1/financing/applications/'.length, -'/submit'.length)
    expect(middle).not.toContain('/')
  })

  it.each(['.', '..', '...'])('neutralises the dot segment %s', async dots => {
    await fetchMyApplication(dots)
    expect(pathOf(calls[0])).toBe('/api/v1/financing/applications/_')
  })

  it('leaves a normal uuid untouched', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    await fetchMyOrder(id)
    expect(pathOf(calls[0])).toBe(`/api/v1/account/orders/${id}`)
  })

  it('encodes slugs too', async () => {
    await fetchProduct('../../auth/customer/me')
    expect(pathOf(calls[0]).split('/').filter(Boolean)).toHaveLength(4)
  })
})
