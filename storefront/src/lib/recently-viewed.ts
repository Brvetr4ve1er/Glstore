import { useCallback, useEffect, useState } from 'react'

const KEY = 'gl_recently_viewed'
const MAX = 12

export function getRecent(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function pushRecent(productId: string): void {
  if (!productId) return
  try {
    const arr = getRecent()
    const next = [productId, ...arr.filter(id => id !== productId)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
    window.dispatchEvent(new Event('gl_recently_viewed_update'))
  } catch {
    /* noop */
  }
}

/** React hook — stays in sync with same-tab updates. */
export function useRecentlyViewed(): string[] {
  const [ids, setIds] = useState<string[]>(() => getRecent())
  const sync = useCallback(() => setIds(getRecent()), [])
  useEffect(() => {
    window.addEventListener('gl_recently_viewed_update', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('gl_recently_viewed_update', sync)
      window.removeEventListener('storage', sync)
    }
  }, [sync])
  return ids
}
