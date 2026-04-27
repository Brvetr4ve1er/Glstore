import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, X as XIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchBrandsPublic, fetchPriceBounds } from '@/lib/api'
import { fmtMoney } from '@/lib/format'
import { Button } from './ui'

export interface FilterState {
  brand: string
  priceMin: number | null
  priceMax: number | null
  inStockOnly: boolean
}

export const EMPTY_FILTERS: FilterState = {
  brand: '',
  priceMin: null,
  priceMax: null,
  inStockOnly: false,
}

interface Props {
  state: FilterState
  onChange: (s: FilterState) => void
  onClose?: () => void
  /** Set when rendered as a mobile drawer */
  drawer?: boolean
}

export function FilterSidebar({ state, onChange, onClose, drawer }: Props) {
  const { data: brands } = useQuery({ queryKey: ['brands'], queryFn: fetchBrandsPublic, staleTime: 5 * 60_000 })
  const { data: bounds } = useQuery({ queryKey: ['price-bounds'], queryFn: fetchPriceBounds, staleTime: 5 * 60_000 })

  const min = bounds?.min ?? 0
  const max = bounds?.max ?? 1_000_000

  return (
    <aside className={drawer ? '' : 'hidden lg:block'}>
      <div className={drawer ? 'h-full overflow-y-auto p-5' : 'glass p-5 sticky top-32'}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-neon-yellow)]">
            Filtres
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)]"
            >
              Réinitialiser
            </button>
            {drawer && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="p-1.5 rounded-md hover:bg-[var(--color-surface-3)] text-[var(--color-text-3)]"
              >
                <XIcon size={16} />
              </button>
            )}
          </div>
        </div>

        <Section title="Disponibilité">
          <label className="flex items-center gap-2.5 cursor-pointer text-sm text-[var(--color-text-2)] py-1">
            <input
              type="checkbox"
              checked={state.inStockOnly}
              onChange={e => onChange({ ...state, inStockOnly: e.target.checked })}
              className="w-4 h-4 accent-[var(--color-electric-blue)]"
            />
            En stock uniquement
          </label>
        </Section>

        <Section title="Marque" defaultOpen>
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => onChange({ ...state, brand: '' })}
              className={`text-left text-sm rounded-lg px-2.5 py-1.5 transition-colors ${
                state.brand === ''
                  ? 'bg-[var(--color-electric-blue)]/15 text-[var(--color-electric-blue)] font-bold'
                  : 'text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)]'
              }`}
            >
              Toutes les marques
            </button>
            {(brands?.items ?? []).slice(0, 30).map(b => (
              <button
                key={b.name}
                type="button"
                onClick={() => onChange({ ...state, brand: b.name })}
                className={`text-left text-sm rounded-lg px-2.5 py-1.5 flex items-center justify-between transition-colors ${
                  state.brand === b.name
                    ? 'bg-[var(--color-electric-blue)]/15 text-[var(--color-electric-blue)] font-bold'
                    : 'text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)]'
                }`}
              >
                <span className="truncate">{b.name}</span>
                <span className="text-[10px] num text-[var(--color-text-3)] shrink-0">{b.count}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Prix" defaultOpen>
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <PriceInput
                label="Min"
                value={state.priceMin ?? ''}
                onChange={v => onChange({ ...state, priceMin: v })}
                placeholder={String(Math.floor(min))}
              />
              <PriceInput
                label="Max"
                value={state.priceMax ?? ''}
                onChange={v => onChange({ ...state, priceMax: v })}
                placeholder={String(Math.ceil(max))}
              />
            </div>
            <div className="text-[10px] text-[var(--color-text-3)] flex items-center justify-between">
              <span>De {fmtMoney(min)}</span>
              <span>à {fmtMoney(max)}</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                ['<20K',     null,    20_000],
                ['20-50K',   20_000,  50_000],
                ['50-100K',  50_000,  100_000],
                ['>100K',    100_000, null],
              ].map(([label, lo, hi]) => (
                <button
                  key={String(label)}
                  type="button"
                  onClick={() => onChange({
                    ...state,
                    priceMin: typeof lo === 'number' ? lo : null,
                    priceMax: typeof hi === 'number' ? hi : null,
                  })}
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border border-[var(--color-surface-4)] text-[var(--color-text-3)] hover:border-[var(--color-electric-blue)]/40 hover:text-[var(--color-text-1)]"
                >
                  {String(label)}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {drawer && (
          <Button variant="accent" className="w-full mt-2" onClick={onClose}>
            Voir les résultats
          </Button>
        )}
      </div>
    </aside>
  )
}


function Section({
  title, children, defaultOpen = true,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-[var(--color-surface-4)]/60 first:border-t-0 py-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full text-left"
        aria-expanded={open}
      >
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-1)]">{title}</span>
        <ChevronDown size={14} className={`text-[var(--color-text-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


function PriceInput({
  label, value, onChange, placeholder,
}: {
  label: string
  value: number | ''
  onChange: (v: number | null) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1 flex-1">
      <span className="text-[10px] font-bold text-[var(--color-text-3)] uppercase tracking-wider">{label}</span>
      <input
        type="number"
        value={value}
        min={0}
        placeholder={placeholder}
        onChange={e => {
          const v = e.target.value
          onChange(v === '' ? null : Number(v))
        }}
        className="h-9 px-2.5 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-sm text-[var(--color-text-1)] outline-none num"
      />
    </div>
  )
}
