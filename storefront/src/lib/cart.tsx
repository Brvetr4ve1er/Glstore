/**
 * Cart store — localStorage-backed, no server-side cart per architecture.
 *
 * Schema:
 *   CartItem = {
 *     productId, productName, productSlug, primaryImage,
 *     offerId, variantSku, unitPrice, currency, quantity, available,
 *     addedAt
 *   }
 *
 * Provider exposes useCart() hook with reducer-driven actions.
 * Persists across tabs via the `storage` event.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer,
  type ReactNode,
} from 'react'

const KEY = 'gl_cart_v1'

export interface CartItem {
  productId: string
  productName: string
  productSlug: string
  primaryImage: string | null
  offerId: string
  variantSku: string
  unitPrice: number
  currency: string
  quantity: number
  available: number
  addedAt: number
}

interface CartState {
  items: CartItem[]
}

type CartAction =
  | { type: 'add';     item: CartItem }
  | { type: 'remove';  offerId: string }
  | { type: 'setQty';  offerId: string; quantity: number }
  | { type: 'clear' }
  | { type: 'hydrate'; state: CartState }


function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const existing = state.items.find(i => i.offerId === action.item.offerId)
      let items: CartItem[]
      if (existing) {
        // Merge: bump quantity (incoming qty acts as a delta, can be 0 to refresh-only),
        // and pull through fresher unitPrice/available/image/name from the caller's
        // snapshot so the cart stays in sync with backend reality.
        const desiredQty = existing.quantity + action.item.quantity
        const cap = action.item.available > 0 ? action.item.available : 999
        const newQty = clamp(Math.max(desiredQty, 1), 1, cap)
        items = state.items.map(i =>
          i.offerId === action.item.offerId
            ? {
                ...i,
                quantity:     newQty,
                unitPrice:    action.item.unitPrice    > 0 ? action.item.unitPrice : i.unitPrice,
                available:    action.item.available,
                primaryImage: action.item.primaryImage ?? i.primaryImage,
                productName:  action.item.productName  || i.productName,
                productSlug:  action.item.productSlug  || i.productSlug,
                currency:     action.item.currency     || i.currency,
              }
            : i,
        )
      } else {
        items = [...state.items, { ...action.item, quantity: Math.max(1, action.item.quantity) }]
      }
      return { items }
    }
    case 'remove':
      return { items: state.items.filter(i => i.offerId !== action.offerId) }
    case 'setQty': {
      if (action.quantity <= 0) {
        return { items: state.items.filter(i => i.offerId !== action.offerId) }
      }
      return {
        items: state.items.map(i =>
          i.offerId === action.offerId
            ? { ...i, quantity: clamp(action.quantity, 1, i.available || 999) }
            : i,
        ),
      }
    }
    case 'clear':
      return { items: [] }
    case 'hydrate':
      return action.state
    default:
      return state
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}


interface CartContextValue {
  items: CartItem[]
  count: number
  subtotal: number
  add: (item: CartItem) => void
  remove: (offerId: string) => void
  setQty: (offerId: string, quantity: number) => void
  clear: () => void
}

const CartContext = createContext<CartContextValue | null>(null)


function loadInitial(): CartState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { items: [] }
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.items)) return { items: [] }
    return { items: parsed.items as CartItem[] }
  } catch {
    return { items: [] }
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial)

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* noop */
    }
  }, [state])

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return
      try {
        const parsed = e.newValue ? JSON.parse(e.newValue) : { items: [] }
        if (parsed && Array.isArray(parsed.items)) {
          dispatch({ type: 'hydrate', state: { items: parsed.items } })
        }
      } catch { /* noop */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const add     = useCallback((item: CartItem) => dispatch({ type: 'add', item }), [])
  const remove  = useCallback((offerId: string) => dispatch({ type: 'remove', offerId }), [])
  const setQty  = useCallback((offerId: string, quantity: number) => dispatch({ type: 'setQty', offerId, quantity }), [])
  const clear   = useCallback(() => dispatch({ type: 'clear' }), [])

  const value = useMemo<CartContextValue>(() => {
    const count = state.items.reduce((s, i) => s + i.quantity, 0)
    const subtotal = state.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    return { items: state.items, count, subtotal, add, remove, setQty, clear }
  }, [state.items, add, remove, setQty, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within <CartProvider>')
  return ctx
}
