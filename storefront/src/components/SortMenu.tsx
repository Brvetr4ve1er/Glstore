import { Select } from './ui'

export type SortOption = 'recent' | 'price_asc' | 'price_desc' | 'completeness'

interface SortMenuProps {
  value: SortOption
  onChange: (s: SortOption) => void
}

export function SortMenu({ value, onChange }: SortMenuProps) {
  return (
    <Select
      label="Trier"
      value={value}
      onChange={e => onChange(e.target.value as SortOption)}
      className="w-44"
    >
      <option value="recent">Nouveautés</option>
      <option value="price_asc">Prix croissant</option>
      <option value="price_desc">Prix décroissant</option>
      <option value="completeness">Mieux décrits</option>
    </Select>
  )
}
