import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/lib/query'
import {
  fetchStores,
  getSelectedStoreId,
  setSelectedStoreId,
  type Store,
} from '@/lib/api'
import { Spinner } from '@/components/ui'

/**
 * Multi-store context for the admin app.
 *
 * Every store-scoped API call carries an `x-store-id` header (injected in
 * api.ts from localStorage). This provider owns *which* store that is: it
 * loads the operator's accessible stores, auto-selects one on first login,
 * persists the choice, and — on switch — invalidates every query so all
 * data re-fetches for the newly-selected brand.
 *
 * Resolution is done DURING RENDER (and localStorage written synchronously)
 * rather than in an effect, so the selected id is in place before any child's
 * scoped query fires — otherwise a platform operator's first requests would go
 * out store-less and 400 with "select a store".
 */
interface StoreCtx {
  stores: Store[]
  current: Store | null
  currentId: string | null
  isPlatformOperator: boolean
  setCurrent: (id: string) => void
  loading: boolean
}

const Ctx = createContext<StoreCtx | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['stores'],
    queryFn: fetchStores,
    staleTime: 5 * 60_000,
  })

  // Manual override from the picker; null means "use the auto-resolved store".
  const [override, setOverride] = useState<string | null>(null)

  const stores = useMemo(() => data?.items ?? [], [data])

  // Resolve the effective store id synchronously.
  const persisted = getSelectedStoreId()
  let resolvedId: string | null = override ?? persisted
  if (data && !override) {
    const validPersisted = persisted && stores.some(s => s.id === persisted) ? persisted : null
    resolvedId = validPersisted ?? data.scoped_store_id ?? (stores[0]?.id ?? null)
  }
  // Keep the header source (localStorage) in lockstep with what we resolved,
  // synchronously, so the very next request carries the right x-store-id.
  if (resolvedId && resolvedId !== getSelectedStoreId()) {
    setSelectedStoreId(resolvedId)
  }

  const setCurrent = useCallback((id: string) => {
    setSelectedStoreId(id)
    setOverride(id)
    // Everything on screen is store-scoped — refetch it all for the new store.
    queryClient.invalidateQueries()
  }, [])

  const current = useMemo(
    () => stores.find(s => s.id === resolvedId) ?? null,
    [stores, resolvedId],
  )

  const value: StoreCtx = {
    stores,
    current,
    currentId: resolvedId,
    isPlatformOperator: data?.is_platform_operator ?? false,
    setCurrent,
    loading: isLoading,
  }

  // Gate rendering only while we still have no store to act on — prevents the
  // first scoped request from firing store-less on a fresh login.
  if (!resolvedId && isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size={28} className="text-[var(--color-brand)]" />
      </div>
    )
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore must be inside StoreProvider')
  return ctx
}
