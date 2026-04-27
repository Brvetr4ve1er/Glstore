/**
 * Catalog Graph — Phase 9 Obsidian-grade rebuild.
 *
 * Three node tiers (brand · category · product) with d3-force physics, a
 * settings panel for live tweaking (charge, link distance, collision, alpha
 * decay, label visibility, product opacity), search overlay with highlight +
 * fade, neighborhood-only highlight on hover, drag-to-reposition with sticky
 * pinning, and localStorage persistence of:
 *   - settings (gl.graph.settings.v1)
 *   - per-graph layout (gl.graph.layout.<key>) — pinned node positions only,
 *     so the simulation re-uses where you placed things last time.
 *
 * Renderer auto-pick:
 *   - <= 220 nodes  → SVG (every node is a real DOM element, accessible)
 *   - >  220 nodes  → Canvas (renders thousands of nodes at 60fps without
 *                              breaking the React reconciler)
 *
 * Backend: /products/graph?include_products=true&product_limit=N — see
 *   api/routes/catalog.py for the shape contract.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation,
  forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force'
import {
  X as XIcon, Search, Settings as SettingsIcon, ImageIcon, Sparkles, Network,
  Link as LinkIcon, ZoomIn, ZoomOut, RotateCcw, ExternalLink,
  Pin, PinOff, Tag, Layers, Box,
} from 'lucide-react'
import {
  fetchCatalogGraph, fetchProducts,
  type GraphNode, type GraphEdgeKind,
} from '@/lib/api'
import { Button, EmptyState, PageHeader, Spinner } from '@/components/ui'
import { fmtMoney, fmtPercent } from '@/lib/utils'


// ── Types ───────────────────────────────────────────────────────────────

interface SimNode extends GraphNode, SimulationNodeDatum {
  pinned?: boolean
}
interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: SimNode | string
  target: SimNode | string
  weight: number
  avg_completeness: number
  kind: GraphEdgeKind
}


// ── Settings (Q5: full Obsidian feel · Q7: localStorage) ────────────────

interface GraphSettings {
  showProducts:    boolean
  productLimit:    number
  charge:          number   // negative = repel; lower = stronger repel
  linkDistance:    number
  collide:         number   // padding around node radius
  alphaDecay:      number
  labelMode:       'all' | 'hubs' | 'none'  // brand/category always labeled in 'hubs'
  productOpacity:  number   // 0..1
  edgeOpacity:     number   // 0..1
  linger:          boolean  // run simulation continuously vs. settle then stop
}

const DEFAULT_SETTINGS: GraphSettings = {
  showProducts:    false,
  productLimit:    600,
  charge:          -260,
  linkDistance:    100,
  collide:         8,
  alphaDecay:      0.04,
  labelMode:       'hubs',
  productOpacity:  0.85,
  edgeOpacity:     0.55,
  linger:          false,
}

const SETTINGS_KEY = 'gl.graph.settings.v1'

function loadSettings(): GraphSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(s: GraphSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* noop */ }
}


// ── Layout persistence (pinned-only) ────────────────────────────────────
//
// We only persist nodes that the user explicitly *pinned* (drag → release).
// Free nodes get re-laid-out on every load so the catalog can grow without
// stale ghost positions.

interface PersistedLayout {
  // id → { x, y }
  pins: Record<string, { x: number; y: number }>
  zoom: number
  pan:  { x: number; y: number }
}

function layoutKey(includeProducts: boolean) {
  return includeProducts ? 'gl.graph.layout.full.v1' : 'gl.graph.layout.tiers.v1'
}

function loadLayout(includeProducts: boolean): PersistedLayout {
  try {
    const raw = localStorage.getItem(layoutKey(includeProducts))
    if (!raw) return { pins: {}, zoom: 1, pan: { x: 0, y: 0 } }
    return JSON.parse(raw)
  } catch {
    return { pins: {}, zoom: 1, pan: { x: 0, y: 0 } }
  }
}

function saveLayout(includeProducts: boolean, layout: PersistedLayout) {
  try { localStorage.setItem(layoutKey(includeProducts), JSON.stringify(layout)) } catch { /* noop */ }
}


// ── Layout constants ────────────────────────────────────────────────────

const WIDTH  = 1400
const HEIGHT = 820

const NODE_RADIUS = {
  brand:    (count: number) => Math.max(10, Math.min(38, 10 + Math.log2(count + 1) * 5)),
  category: (count: number) => Math.max(14, Math.min(52, 14 + Math.log2(count + 1) * 7)),
  product:  () => 4.5,
}

// Renderer threshold (Q6: efficiency takes priority — auto pick)
const SVG_NODE_THRESHOLD = 220


// ── Node colour — palette-driven so theme changes propagate ────────────

function nodeFill(n: SimNode): string {
  if (n.type === 'category') return 'var(--color-bold-blue)'
  if (n.type === 'product') {
    if ((n.score ?? 0) > 0.8) return 'var(--color-success)'
    if ((n.score ?? 0) > 0.5) return 'var(--color-electric-blue)'
    return 'var(--color-hot-pink)'
  }
  // brand
  if ((n.score ?? 0) > 0.8) return 'var(--color-success)'
  if ((n.score ?? 0) > 0.5) return 'var(--color-electric-blue)'
  return 'var(--color-hot-pink)'
}

function nodeStroke(n: SimNode, isSelected: boolean): string {
  if (isSelected) return 'var(--color-neon-yellow)'
  if (n.type === 'category') return 'var(--color-electric-blue)'
  return 'var(--color-jet-black)'
}


// ── Component ───────────────────────────────────────────────────────────

export default function CatalogGraph() {
  const [settings, setSettings] = useState<GraphSettings>(() => loadSettings())
  const [showSettings, setShowSettings] = useState(false)
  const [showSearch,   setShowSearch]   = useState(false)
  const [search,       setSearch]       = useState('')
  const [selected,     setSelected]     = useState<SimNode | null>(null)
  const [hovered,      setHovered]      = useState<string | null>(null)

  // initial layout from localStorage (pin positions + zoom/pan)
  const initialLayout = useMemo(() => loadLayout(settings.showProducts), [settings.showProducts])
  const [zoom, setZoom] = useState<number>(initialLayout.zoom)
  const [pan,  setPan]  = useState<{ x: number; y: number }>(initialLayout.pan)
  const dragViewport = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null)
  const dragNode     = useRef<{ id: string } | null>(null)

  // Persist settings
  useEffect(() => { saveSettings(settings) }, [settings])

  // Persist viewport
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = loadLayout(settings.showProducts)
      saveLayout(settings.showProducts, { ...cur, zoom, pan })
    }, 250)
    return () => clearTimeout(t)
  }, [zoom, pan, settings.showProducts])

  // Backend query
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['catalog-graph', settings.showProducts, settings.productLimit],
    queryFn:  () => fetchCatalogGraph({
      include_products: settings.showProducts,
      product_limit:    settings.productLimit,
    }),
    staleTime: 60_000,
  })

  // Build sim nodes/edges, applying persisted pins
  const [layout, setLayout] = useState<{ nodes: SimNode[]; edges: SimEdge[] } | null>(null)
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null)
  const tickRef = useRef(0)
  const [, force] = useState(0)  // re-render hook for canvas / svg ticks

  useEffect(() => {
    if (!data) return
    const pins = loadLayout(settings.showProducts).pins
    const nodes: SimNode[] = data.nodes.map(n => {
      const node: SimNode = { ...n }
      const pin = pins[n.id]
      if (pin) {
        node.x = pin.x; node.y = pin.y
        node.fx = pin.x; node.fy = pin.y
        node.pinned = true
      }
      return node
    })
    const idx = new Map(nodes.map(n => [n.id, n]))
    const edges: SimEdge[] = data.edges.map(e => ({
      ...e,
      source: idx.get(e.source as string)! ?? e.source,
      target: idx.get(e.target as string)! ?? e.target,
    }))

    simRef.current?.stop()
    const sim: Simulation<SimNode, SimEdge> = forceSimulation(nodes)
      .force('charge',  forceManyBody().strength(settings.charge))
      .force('link',    forceLink<SimNode, SimEdge>(edges).id(d => d.id)
        .distance(d => settings.linkDistance + Math.max(0, 30 - d.weight * 3))
        .strength(d => Math.min(1, 0.05 + d.weight * 0.04)))
      .force('center',  forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collide', forceCollide<SimNode>().radius(d =>
        radiusFor(d) + settings.collide,
      ))
      // Cluster product nodes radially: products stay near their connected hubs
      // by gently pulling them toward the centre while link-force does the rest.
      .force('x', forceX<SimNode>(WIDTH / 2).strength(d => d.type === 'product' ? 0.02 : 0.01))
      .force('y', forceY<SimNode>(HEIGHT / 2).strength(d => d.type === 'product' ? 0.02 : 0.01))
      .alpha(1).alphaDecay(settings.alphaDecay)

    if (settings.linger) {
      // Continuous simulation — re-render every tick.
      sim.on('tick', () => {
        tickRef.current += 1
        if (tickRef.current % 2 === 0) force(v => v + 1)
      })
    } else {
      sim.tick(300)
      sim.stop()
    }

    simRef.current = sim
    setLayout({ nodes, edges })

    return () => { sim.stop() }
  }, [data, settings.charge, settings.linkDistance, settings.collide, settings.alphaDecay, settings.linger, settings.showProducts])

  // Reheat sim on physics change without rebuilding (smoother feel)
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    sim.alpha(0.4).restart()
  }, [settings.charge, settings.linkDistance, settings.collide])

  // Adjacency map for hover/search highlighting
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>()
    if (!layout) return m
    layout.edges.forEach(e => {
      const sId = typeof e.source === 'string' ? e.source : e.source.id
      const tId = typeof e.target === 'string' ? e.target : e.target.id
      if (!m.has(sId)) m.set(sId, new Set())
      if (!m.has(tId)) m.set(tId, new Set())
      m.get(sId)!.add(tId)
      m.get(tId)!.add(sId)
    })
    return m
  }, [layout])

  // Search-matching nodes (substring, case-insensitive)
  const searchMatches = useMemo(() => {
    if (!search.trim() || !layout) return null
    const q = search.toLowerCase()
    const matches = new Set<string>()
    for (const n of layout.nodes) {
      if (n.label.toLowerCase().includes(q)) matches.add(n.id)
      else if (n.type === 'product' && n.sku?.toLowerCase().includes(q)) matches.add(n.id)
    }
    return matches
  }, [search, layout])

  // What to highlight: search matches + hovered neighborhood
  const highlight = useMemo(() => {
    if (!layout) return null
    if (searchMatches && searchMatches.size > 0) {
      // Expand to neighbors of every match for context
      const set = new Set<string>(searchMatches)
      searchMatches.forEach(id => adjacency.get(id)?.forEach(n => set.add(n)))
      return set
    }
    if (hovered) {
      const set = new Set<string>([hovered])
      adjacency.get(hovered)?.forEach(n => set.add(n))
      return set
    }
    return null
  }, [searchMatches, hovered, adjacency, layout])

  // Renderer pick
  const useCanvas = (layout?.nodes.length ?? 0) > SVG_NODE_THRESHOLD

  // ── Pan handlers ──────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest('[data-node]')) return
    dragViewport.current = { ox: pan.x, oy: pan.y, px: e.clientX, py: e.clientY }
  }, [pan])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragNode.current) return  // node-drag takes precedence
    if (!dragViewport.current) return
    const dx = e.clientX - dragViewport.current.px
    const dy = e.clientY - dragViewport.current.py
    setPan({ x: dragViewport.current.ox + dx, y: dragViewport.current.oy + dy })
  }, [])

  const onMouseUp = useCallback(() => { dragViewport.current = null }, [])

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  const togglePin = useCallback((nodeId: string) => {
    const layout = simRef.current?.nodes() as SimNode[] | undefined
    if (!layout) return
    const n = layout.find(x => x.id === nodeId)
    if (!n) return
    if (n.pinned) {
      n.pinned = false
      n.fx = null
      n.fy = null
    } else {
      n.pinned = true
      n.fx = n.x
      n.fy = n.y
    }
    // Persist
    const cur = loadLayout(settings.showProducts)
    cur.pins = cur.pins ?? {}
    if (n.pinned && n.x != null && n.y != null) cur.pins[n.id] = { x: n.x, y: n.y }
    else delete cur.pins[n.id]
    saveLayout(settings.showProducts, cur)
    simRef.current?.alpha(0.2).restart()
    force(v => v + 1)
  }, [settings.showProducts])

  // Clear all pins
  const clearPins = () => {
    const sim = simRef.current
    if (!sim) return
    sim.nodes().forEach(n => {
      const sn = n as SimNode
      sn.pinned = false
      sn.fx = null; sn.fy = null
    })
    const cur = loadLayout(settings.showProducts)
    cur.pins = {}
    saveLayout(settings.showProducts, cur)
    sim.alpha(0.6).restart()
  }

  // Keyboard: Esc closes overlays, / opens search, Cmd/Ctrl+S toggles settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selected) setSelected(null)
        else if (showSearch) setShowSearch(false)
        else if (showSettings) setShowSettings(false)
      } else if (e.key === '/' && !showSearch && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        setShowSearch(true)
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, showSearch, showSettings])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Catalog Graph"
        sub={
          data
            ? `${data.stats.brand_count} marques · ${data.stats.category_count} catégories · ${data.stats.product_count} produits · ${data.stats.edge_count} relations`
            : 'Cartographie marques × catégories × produits'
        }
        actions={
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant={settings.showProducts ? 'accent' : 'outline'}
              size="sm"
              onClick={() => setSettings(s => ({ ...s, showProducts: !s.showProducts }))}
              title="Afficher les nœuds produits (Q5)"
            >
              <Box size={13} /> Produits
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowSearch(v => !v)} title="Rechercher (/)">
              <Search size={13} /> Rechercher
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowSettings(v => !v)} title="Réglages physiques (Ctrl+,)">
              <SettingsIcon size={13} /> Physique
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZoom(z => Math.min(z * 1.25, 3))}>
              <ZoomIn size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZoom(z => Math.max(z / 1.25, 0.4))}>
              <ZoomOut size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={resetView}>
              <RotateCcw size={13} /> Reset vue
            </Button>
          </div>
        }
      />

      <div className="glass overflow-hidden relative">
        {isPending && (
          <div className="flex items-center justify-center h-[60vh]">
            <Spinner size={28} className="text-[var(--color-electric-blue)]" />
          </div>
        )}
        {isError && (
          <div className="py-12">
            <EmptyState
              title="Erreur"
              desc="Impossible de charger le graphe."
              action={<Button variant="outline" size="sm" onClick={() => refetch()}>Réessayer</Button>}
            />
          </div>
        )}

        {layout && (
          <div
            className="relative w-full overflow-hidden cursor-grab active:cursor-grabbing select-none"
            style={{ height: 'min(820px, calc(100dvh - 240px))' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={e => {
              if (!e.ctrlKey && !e.metaKey) return
              e.preventDefault()
              setZoom(z => Math.max(0.4, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 0.9))))
            }}
          >
            {useCanvas
              ? <CanvasRenderer
                  layout={layout}
                  zoom={zoom} pan={pan}
                  highlight={highlight}
                  hovered={hovered}
                  selected={selected?.id ?? null}
                  settings={settings}
                  onHover={setHovered}
                  onSelect={(n) => setSelected(n)}
                  onNodeDrag={(n, x, y, isFinal) => {
                    n.fx = x; n.fy = y
                    if (isFinal) {
                      // Pin on drag-release
                      n.pinned = true
                      const cur = loadLayout(settings.showProducts)
                      cur.pins = cur.pins ?? {}
                      cur.pins[n.id] = { x, y }
                      saveLayout(settings.showProducts, cur)
                    }
                    simRef.current?.alpha(0.3).restart()
                  }}
                  setDragNode={(id) => { dragNode.current = id ? { id } : null }}
                />
              : <SvgRenderer
                  layout={layout}
                  zoom={zoom} pan={pan}
                  highlight={highlight}
                  hovered={hovered}
                  selected={selected?.id ?? null}
                  settings={settings}
                  onHover={setHovered}
                  onSelect={(n) => setSelected(n)}
                  onNodeDrag={(n, x, y, isFinal) => {
                    n.fx = x; n.fy = y
                    if (isFinal) {
                      n.pinned = true
                      const cur = loadLayout(settings.showProducts)
                      cur.pins = cur.pins ?? {}
                      cur.pins[n.id] = { x, y }
                      saveLayout(settings.showProducts, cur)
                    }
                    simRef.current?.alpha(0.3).restart()
                  }}
                  setDragNode={(id) => { dragNode.current = id ? { id } : null }}
                />
            }

            {/* Search overlay */}
            <AnimatePresence>
              {showSearch && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="absolute top-3 left-1/2 -translate-x-1/2 w-[min(480px,calc(100%-2rem))] glass-sm flex items-center gap-2 px-3 py-2 z-10"
                >
                  <Search size={14} className="text-[var(--color-electric-blue)]" />
                  <input
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Marque, catégorie, produit, SKU…"
                    className="flex-1 bg-transparent outline-none text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)]"
                  />
                  {searchMatches && (
                    <span className="text-[10px] text-[var(--color-text-3)] num">
                      {searchMatches.size}
                    </span>
                  )}
                  <button
                    onClick={() => { setSearch(''); setShowSearch(false) }}
                    className="text-[var(--color-text-3)] hover:text-[var(--color-text-1)]"
                  >
                    <XIcon size={14} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Settings panel */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  className="absolute top-3 right-3 w-[280px] glass p-4 z-10"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-2)] flex items-center gap-2">
                      <Layers size={12} /> Physique du graphe
                    </h3>
                    <button onClick={() => setShowSettings(false)}><XIcon size={14} /></button>
                  </div>

                  <SettingSlider
                    label="Répulsion (charge)"
                    value={settings.charge}
                    onChange={v => setSettings(s => ({ ...s, charge: v }))}
                    min={-800} max={-40} step={20}
                    fmt={v => `${v}`}
                  />
                  <SettingSlider
                    label="Distance des liens"
                    value={settings.linkDistance}
                    onChange={v => setSettings(s => ({ ...s, linkDistance: v }))}
                    min={20} max={300} step={5}
                    fmt={v => `${v}px`}
                  />
                  <SettingSlider
                    label="Collision (padding)"
                    value={settings.collide}
                    onChange={v => setSettings(s => ({ ...s, collide: v }))}
                    min={0} max={40} step={1}
                    fmt={v => `${v}px`}
                  />
                  <SettingSlider
                    label="Alpha decay (vitesse de stabilisation)"
                    value={settings.alphaDecay}
                    onChange={v => setSettings(s => ({ ...s, alphaDecay: v }))}
                    min={0.005} max={0.1} step={0.005}
                    fmt={v => v.toFixed(3)}
                  />
                  <SettingSlider
                    label="Opacité produits"
                    value={settings.productOpacity}
                    onChange={v => setSettings(s => ({ ...s, productOpacity: v }))}
                    min={0.1} max={1} step={0.05}
                    fmt={v => `${Math.round(v * 100)}%`}
                  />
                  <SettingSlider
                    label="Opacité liens"
                    value={settings.edgeOpacity}
                    onChange={v => setSettings(s => ({ ...s, edgeOpacity: v }))}
                    min={0.05} max={1} step={0.05}
                    fmt={v => `${Math.round(v * 100)}%`}
                  />

                  {settings.showProducts && (
                    <SettingSlider
                      label="Limite de produits"
                      value={settings.productLimit}
                      onChange={v => setSettings(s => ({ ...s, productLimit: v }))}
                      min={50} max={4000} step={50}
                      fmt={v => `${v}`}
                    />
                  )}

                  <div className="mt-3 pt-3 border-t border-[var(--color-surface-4)] flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-xs text-[var(--color-text-2)] cursor-pointer">
                      <input type="checkbox" checked={settings.linger}
                        onChange={e => setSettings(s => ({ ...s, linger: e.target.checked }))}
                      />
                      Simulation continue (60fps)
                    </label>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-2)]">
                      <Tag size={11} /> Étiquettes :
                      <select
                        value={settings.labelMode}
                        onChange={e => setSettings(s => ({ ...s, labelMode: e.target.value as GraphSettings['labelMode'] }))}
                        className="bg-[var(--color-surface-3)] rounded px-1.5 py-0.5 text-[11px] border border-[var(--color-surface-4)]"
                      >
                        <option value="none">Aucune</option>
                        <option value="hubs">Hubs</option>
                        <option value="all">Toutes</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-[var(--color-surface-4)] flex items-center justify-between gap-2">
                    <Button variant="ghost" size="sm" onClick={clearPins}>
                      <PinOff size={11} /> Libérer pins
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setSettings(DEFAULT_SETTINGS); resetView() }}>
                      <RotateCcw size={11} /> Réglages par défaut
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Legend */}
            <div className="absolute bottom-4 left-4 glass-sm px-3 py-2.5 text-[10px] flex flex-col gap-1 pointer-events-none">
              <LegendDot color="var(--color-bold-blue)" border="var(--color-electric-blue)" label="Catégorie" />
              <LegendDot color="var(--color-success)"        label="Marque · score > 0.8" />
              <LegendDot color="var(--color-electric-blue)"  label="Marque · score > 0.5" />
              <LegendDot color="var(--color-hot-pink)"       label="Marque · à enrichir" />
              {settings.showProducts && (
                <LegendDot color="var(--color-electric-blue)" small label="Produit (taille fixe)" />
              )}
              <div className="text-[var(--color-text-3)] mt-1 italic">
                Glisser : déplacer · Glisser nœud : épingler<br/>
                Ctrl+molette : zoom · / : recherche · Ctrl+, : physique
              </div>
              {useCanvas && (
                <div className="text-[var(--color-electric-blue)] mt-1 font-bold">
                  Renderer : Canvas ({layout.nodes.length} nœuds)
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Node detail drawer */}
      <NodeDetailDrawer
        node={selected}
        onClose={() => setSelected(null)}
        onTogglePin={() => selected && togglePin(selected.id)}
      />
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function radiusFor(n: SimNode): number {
  if (n.type === 'category') return NODE_RADIUS.category(n.count)
  if (n.type === 'product')  return NODE_RADIUS.product()
  return NODE_RADIUS.brand(n.count)
}

function shouldLabel(n: SimNode, mode: GraphSettings['labelMode'], hover: string | null, highlight: Set<string> | null): boolean {
  if (mode === 'all') return true
  if (mode === 'none') {
    return hover === n.id || highlight?.has(n.id) === true
  }
  // 'hubs' — brand & category always; products only on hover/match
  if (n.type !== 'product') return true
  return hover === n.id || highlight?.has(n.id) === true
}


// ─────────────────────────────────────────────────────────────────────────
// SVG renderer (≤ SVG_NODE_THRESHOLD nodes — accessible, animated)
// ─────────────────────────────────────────────────────────────────────────

interface RendererProps {
  layout: { nodes: SimNode[]; edges: SimEdge[] }
  zoom:   number
  pan:    { x: number; y: number }
  highlight: Set<string> | null
  hovered: string | null
  selected: string | null
  settings: GraphSettings
  onHover: (id: string | null) => void
  onSelect: (n: SimNode) => void
  onNodeDrag: (n: SimNode, x: number, y: number, isFinal: boolean) => void
  setDragNode: (id: string | null) => void
}

function SvgRenderer(props: RendererProps) {
  const { layout, zoom, pan, highlight, hovered, selected, settings, onHover, onSelect, onNodeDrag, setDragNode } = props
  const svgRef = useRef<SVGSVGElement | null>(null)

  const dragRef = useRef<{ node: SimNode } | null>(null)

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const svg = svgRef.current
    if (!svg) return { x: sx, y: sy }
    const rect = svg.getBoundingClientRect()
    // Convert client → svg viewBox px
    const vbX = (sx - rect.left) * (WIDTH  / rect.width)
    const vbY = (sy - rect.top)  * (HEIGHT / rect.height)
    // Undo translate(pan) scale(zoom)
    return { x: (vbX - pan.x) / zoom, y: (vbY - pan.y) / zoom }
  }, [pan, zoom])

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full h-full"
      style={{ display: 'block' }}
      role="img"
      aria-label="Graphe catalogue : marques, catégories, produits"
      onMouseMove={(e) => {
        if (dragRef.current) {
          const { x, y } = screenToWorld(e.clientX, e.clientY)
          onNodeDrag(dragRef.current.node, x, y, false)
        }
      }}
      onMouseUp={() => {
        if (dragRef.current) {
          const n = dragRef.current.node
          if (n.x != null && n.y != null) onNodeDrag(n, n.x, n.y, true)
          dragRef.current = null
          setDragNode(null)
        }
      }}
    >
      <defs>
        <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {/* Edges */}
        <g>
          {layout.edges.map((e, i) => {
            const s = e.source as SimNode
            const t = e.target as SimNode
            if (!s.x || !t.x) return null
            const sId = s.id, tId = t.id
            const isProductEdge = e.kind !== 'brand-category'
            const dimmed = highlight && !(highlight.has(sId) && highlight.has(tId))
            const stroke = isProductEdge
              ? 'var(--color-text-3)'
              : (e.avg_completeness > 0.8 ? 'var(--color-success)'
                 : e.avg_completeness > 0.5 ? 'var(--color-electric-blue)'
                                            : 'var(--color-hot-pink)')
            const sw = isProductEdge ? 0.6 : Math.max(0.6, Math.min(3.5, Math.log2(e.weight + 1) * 0.8))
            return (
              <line
                key={i}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={stroke}
                strokeWidth={sw}
                strokeOpacity={dimmed ? 0.06 : settings.edgeOpacity}
                style={{ transition: 'stroke-opacity 0.2s' }}
              />
            )
          })}
        </g>

        {/* Nodes */}
        <g>
          {layout.nodes.map(n => {
            if (n.x == null || n.y == null) return null
            const r = radiusFor(n)
            const dimmed = highlight && !highlight.has(n.id)
            const isHover = hovered === n.id
            const isSelected = selected === n.id
            const baseOpacity = n.type === 'product' ? settings.productOpacity : 1
            const opacity = dimmed ? 0.15 : baseOpacity
            return (
              <motion.g
                key={n.id}
                data-node
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => onHover(n.id)}
                onMouseLeave={() => onHover(null)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  dragRef.current = { node: n }
                  setDragNode(n.id)
                }}
                onClick={(e) => { if (!e.shiftKey) onSelect(n) }}
                role="button"
                tabIndex={0}
                aria-label={`${n.type}: ${n.label}, ${n.count} produit${n.count !== 1 ? 's' : ''}`}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(n) } }}
              >
                <circle
                  cx={n.x} cy={n.y} r={r + (isHover ? 3 : 0)}
                  fill={nodeFill(n)}
                  stroke={nodeStroke(n, isSelected)}
                  strokeWidth={isSelected ? 3 : n.type === 'category' ? 2 : 1.5}
                  filter={isHover || isSelected ? 'url(#node-glow)' : undefined}
                  style={{ transition: 'all 200ms' }}
                />
                {n.pinned && (
                  <circle
                    cx={n.x! + r * 0.7} cy={n.y! - r * 0.7} r={2}
                    fill="var(--color-neon-yellow)" stroke="var(--color-jet-black)" strokeWidth={0.5}
                  />
                )}
                {shouldLabel(n, settings.labelMode, hovered, highlight) && (
                  <text
                    x={n.x}
                    y={n.y + r + 12}
                    textAnchor="middle"
                    fontSize={n.type === 'category' ? 12 : n.type === 'brand' ? 10 : 9}
                    fontWeight={n.type === 'category' ? 800 : 700}
                    fill={dimmed ? 'var(--color-text-3)' : 'var(--color-text-1)'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {n.label.length > 20 ? n.label.slice(0, 18) + '…' : n.label}
                  </text>
                )}
                {n.type !== 'product' && (
                  <text
                    x={n.x}
                    y={n.y + 4}
                    textAnchor="middle"
                    fontSize={Math.max(9, r * 0.45)}
                    fontWeight={900}
                    fill={n.type === 'category' ? 'var(--color-electric-blue)' : 'var(--color-jet-black)'}
                    style={{ pointerEvents: 'none', userSelect: 'none', fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    {n.count}
                  </text>
                )}
              </motion.g>
            )
          })}
        </g>
      </g>
    </svg>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// Canvas renderer (>SVG_NODE_THRESHOLD nodes)
// ─────────────────────────────────────────────────────────────────────────

function CanvasRenderer(props: RendererProps) {
  const { layout, zoom, pan, highlight, hovered, selected, settings, onHover, onSelect, onNodeDrag, setDragNode } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ node: SimNode } | null>(null)
  const [size, setSize] = useState({ w: WIDTH, h: HEIGHT })

  // Resize observer for responsive canvas
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Resolve CSS vars to actual colours so canvas can paint them.
  const palette = useResolvedPalette()

  // Map world (viewBox) → canvas px
  const worldToCanvas = useCallback((wx: number, wy: number) => ({
    x: ((wx * zoom) + pan.x) * (size.w / WIDTH),
    y: ((wy * zoom) + pan.y) * (size.h / HEIGHT),
  }), [zoom, pan, size])

  const canvasToWorld = useCallback((cx: number, cy: number) => ({
    x: ((cx * (WIDTH  / size.w)) - pan.x) / zoom,
    y: ((cy * (HEIGHT / size.h)) - pan.y) / zoom,
  }), [zoom, pan, size])

  // Hit-test: find topmost node under cursor (in canvas px)
  const nodeAt = useCallback((cx: number, cy: number): SimNode | null => {
    for (let i = layout.nodes.length - 1; i >= 0; i--) {
      const n = layout.nodes[i]
      if (n.x == null || n.y == null) continue
      const p = worldToCanvas(n.x, n.y)
      const r = radiusFor(n) * zoom * (size.w / WIDTH) + 2
      const dx = cx - p.x, dy = cy - p.y
      if (dx * dx + dy * dy <= r * r) return n
    }
    return null
  }, [layout, worldToCanvas, zoom, size])

  // Render every animation frame so we capture sim ticks even in linger mode
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.floor(size.w * dpr)) canvas.width = Math.floor(size.w * dpr)
      if (canvas.height !== Math.floor(size.h * dpr)) canvas.height = Math.floor(size.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size.w, size.h)

      // Edges
      for (const e of layout.edges) {
        const s = e.source as SimNode
        const t = e.target as SimNode
        if (s.x == null || s.y == null || t.x == null || t.y == null) continue
        const sId = s.id, tId = t.id
        const dimmed = highlight && !(highlight.has(sId) && highlight.has(tId))
        const ps = worldToCanvas(s.x, s.y)
        const pt = worldToCanvas(t.x, t.y)
        const isProductEdge = e.kind !== 'brand-category'
        ctx.lineWidth = isProductEdge ? 0.6 : Math.max(0.6, Math.min(3.5, Math.log2(e.weight + 1) * 0.8))
        ctx.strokeStyle = isProductEdge
          ? palette.text3
          : (e.avg_completeness > 0.8 ? palette.success
             : e.avg_completeness > 0.5 ? palette.electricBlue
                                        : palette.hotPink)
        ctx.globalAlpha = dimmed ? 0.06 : settings.edgeOpacity
        ctx.beginPath()
        ctx.moveTo(ps.x, ps.y)
        ctx.lineTo(pt.x, pt.y)
        ctx.stroke()
      }

      // Nodes
      for (const n of layout.nodes) {
        if (n.x == null || n.y == null) continue
        const p = worldToCanvas(n.x, n.y)
        const baseR = radiusFor(n) * zoom * (size.w / WIDTH)
        const r = baseR + (hovered === n.id ? 3 : 0)
        const dimmed = highlight && !highlight.has(n.id)
        const baseOpacity = n.type === 'product' ? settings.productOpacity : 1
        ctx.globalAlpha = dimmed ? 0.15 : baseOpacity

        ctx.fillStyle = resolveNodeColor(n, palette)
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fill()

        // Stroke
        ctx.lineWidth = selected === n.id ? 3 : n.type === 'category' ? 2 : 1.5
        ctx.strokeStyle = selected === n.id
          ? palette.neonYellow
          : n.type === 'category' ? palette.electricBlue : palette.jetBlack
        ctx.stroke()

        // Pin marker
        if (n.pinned) {
          ctx.globalAlpha = 1
          ctx.fillStyle = palette.neonYellow
          ctx.beginPath()
          ctx.arc(p.x + r * 0.7, p.y - r * 0.7, 2, 0, Math.PI * 2)
          ctx.fill()
        }

        // Label
        if (shouldLabel(n, settings.labelMode, hovered, highlight)) {
          ctx.globalAlpha = dimmed ? 0.4 : 1
          const fs = n.type === 'category' ? 12 : n.type === 'brand' ? 10 : 9
          ctx.font = `${n.type === 'category' ? 800 : 700} ${fs}px Inter, sans-serif`
          ctx.fillStyle = dimmed ? palette.text3 : palette.text1
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          const lbl = n.label.length > 20 ? n.label.slice(0, 18) + '…' : n.label
          ctx.fillText(lbl, p.x, p.y + r + 4)
        }
      }
      ctx.globalAlpha = 1

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [layout, zoom, pan, size, highlight, hovered, selected, settings, palette])

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onMouseMove={e => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        if (dragRef.current) {
          const { x, y } = canvasToWorld(cx, cy)
          onNodeDrag(dragRef.current.node, x, y, false)
          return
        }
        const n = nodeAt(cx, cy)
        onHover(n?.id ?? null)
      }}
      onMouseDown={e => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const n = nodeAt(cx, cy)
        if (n) {
          e.preventDefault()
          e.stopPropagation()
          dragRef.current = { node: n }
          setDragNode(n.id)
        }
      }}
      onMouseUp={() => {
        if (dragRef.current) {
          const n = dragRef.current.node
          if (n.x != null && n.y != null) onNodeDrag(n, n.x, n.y, true)
          dragRef.current = null
          setDragNode(null)
        }
      }}
      onClick={e => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top)
        if (n) onSelect(n)
      }}
      role="img"
      aria-label="Graphe catalogue Canvas"
    >
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, display: 'block', cursor: hovered ? 'pointer' : undefined }}
        data-node-canvas={hovered ? 'hover' : undefined}
      />
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// Resolved palette (CSS vars → hex) — keeps canvas in sync with theme
// ─────────────────────────────────────────────────────────────────────────

interface Palette {
  electricBlue: string
  boldBlue:     string
  neonYellow:   string
  hotPink:      string
  jetBlack:     string
  success:      string
  text1:        string
  text3:        string
}

function useResolvedPalette(): Palette {
  const [pal, setPal] = useState<Palette>(() => readPalette())
  useEffect(() => {
    setPal(readPalette())
    // Re-read on theme change events (custom event from ThemeCard)
    const handler = () => setPal(readPalette())
    window.addEventListener('gl:theme-changed', handler)
    return () => window.removeEventListener('gl:theme-changed', handler)
  }, [])
  return pal
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const get = (k: string, fallback: string) => (cs.getPropertyValue(k).trim() || fallback)
  return {
    electricBlue: get('--color-electric-blue', '#3DA9FC'),
    boldBlue:     get('--color-bold-blue',     '#1E466B'),
    neonYellow:   get('--color-neon-yellow',   '#FFD400'),
    hotPink:      get('--color-hot-pink',      '#FF2E7A'),
    jetBlack:     get('--color-jet-black',     '#0D0D0D'),
    success:      get('--color-success',       '#22c55e'),
    text1:        get('--color-text-1',        '#f7f7f7'),
    text3:        get('--color-text-3',        '#6b6b85'),
  }
}

function resolveNodeColor(n: SimNode, p: Palette): string {
  if (n.type === 'category') return p.boldBlue
  const s = n.score ?? 0
  if (s > 0.8) return p.success
  if (s > 0.5) return p.electricBlue
  return p.hotPink
}


// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function SettingSlider({
  label, value, onChange, min, max, step, fmt,
}: {
  label: string; value: number
  onChange: (v: number) => void
  min: number; max: number; step: number
  fmt: (v: number) => string
}) {
  return (
    <label className="block mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] text-[var(--color-text-2)] font-bold uppercase tracking-[0.14em]">{label}</span>
        <span className="num text-[10px] text-[var(--color-electric-blue)]">{fmt(value)}</span>
      </div>
      <input
        type="range"
        value={value} onChange={e => onChange(Number(e.target.value))}
        min={min} max={max} step={step}
        className="w-full accent-[var(--color-electric-blue)]"
      />
    </label>
  )
}

function LegendDot({ color, border, label, small }: { color: string; border?: string; label: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={small ? 'w-1.5 h-1.5 rounded-full' : 'w-3 h-3 rounded-full'}
        style={{ background: color, border: border ? `2px solid ${border}` : undefined }}
      />
      <span className="text-[var(--color-text-2)]">{label}</span>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// Node detail drawer
// ─────────────────────────────────────────────────────────────────────────

function NodeDetailDrawer({
  node, onClose, onTogglePin,
}: {
  node: SimNode | null
  onClose: () => void
  onTogglePin: () => void
}) {
  const open = node !== null
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  return (
    <AnimatePresence>
      {open && node && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed top-0 right-0 bottom-0 w-full max-w-xl glass z-50 overflow-y-auto"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            role="dialog" aria-modal="true"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-electric-blue)] via-[var(--color-neon-yellow)] to-[var(--color-hot-pink)]" />
            <DrawerBody node={node} onClose={onClose} onTogglePin={onTogglePin} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}


function DrawerBody({ node, onClose, onTogglePin }: { node: SimNode; onClose: () => void; onTogglePin: () => void }) {
  // Pull the products that belong to this node (or detail of a single product)
  const isProduct = node.type === 'product'
  const params: Record<string, string | number> = { page_size: 12 }
  if (node.type === 'brand')    params.brand    = node.label
  if (node.type === 'category') params.category = node.label

  const products = useQuery({
    queryKey: ['graph-products', node.id],
    queryFn: () => fetchProducts(params),
    enabled: !isProduct,
  })

  const Icon = node.type === 'category' ? Network : node.type === 'brand' ? LinkIcon : Box

  return (
    <div className="p-6 pt-8 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[var(--color-electric-blue)]/15 flex items-center justify-center shrink-0">
            <Icon size={20} className="text-[var(--color-electric-blue)]" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)]">
              {node.type === 'brand' ? 'Marque' : node.type === 'category' ? 'Catégorie' : 'Produit'}
            </div>
            <h2 className="text-xl font-black text-[var(--color-text-1)] truncate">{node.label}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePin}
            title={node.pinned ? 'Détacher (libre)' : 'Épingler ici'}
            className="p-2 rounded-lg hover:bg-[var(--color-surface-3)] text-[var(--color-text-3)] hover:text-[var(--color-neon-yellow)]"
          >
            {node.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button onClick={onClose} aria-label="Fermer"
            className="p-2 rounded-lg hover:bg-[var(--color-surface-3)] text-[var(--color-text-3)]">
            <XIcon size={16} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {!isProduct ? (
          <>
            <div className="glass-sm p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">Produits</div>
              <div className="num text-2xl font-black text-[var(--color-text-1)] mt-1">{node.count}</div>
            </div>
            <div className="glass-sm p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">Complétude moyenne</div>
              <div className="num text-2xl font-black text-[var(--color-text-1)] mt-1">{fmtPercent(node.score ?? 0)}</div>
            </div>
          </>
        ) : (
          <>
            <div className="glass-sm p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">Marque</div>
              <div className="text-sm font-black text-[var(--color-text-1)] mt-1">{node.brand ?? '—'}</div>
            </div>
            <div className="glass-sm p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">Catégorie</div>
              <div className="text-sm font-black text-[var(--color-text-1)] mt-1">{node.category ?? '—'}</div>
            </div>
            <div className="glass-sm p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">Statut</div>
              <div className="text-sm font-black text-[var(--color-text-1)] mt-1">{node.status ?? '—'}</div>
            </div>
            <div className="glass-sm p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-3)]">Complétude</div>
              <div className="num text-2xl font-black text-[var(--color-text-1)] mt-1">{fmtPercent(node.score ?? 0)}</div>
            </div>
          </>
        )}
      </div>

      {/* Quick links */}
      <div className="flex gap-2 flex-wrap">
        {isProduct ? (
          <Link to={`/products/${node.id.replace(/^product:/, '')}`}>
            <Button variant="accent" size="sm">
              <Sparkles size={13} /> Ouvrir le produit
            </Button>
          </Link>
        ) : (
          <Link
            to={node.type === 'brand'
              ? `/products?brand=${encodeURIComponent(node.label)}`
              : `/products?category=${encodeURIComponent(node.label)}`}
          >
            <Button variant="accent" size="sm">
              <Sparkles size={13} /> Voir tous les produits
            </Button>
          </Link>
        )}
        {!isProduct && (
          <a
            href={node.type === 'brand'
              ? `http://localhost:5173/c/all`
              : `http://localhost:5173/c/${encodeURIComponent(node.label)}`}
            target="_blank" rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm">
              <ExternalLink size={12} /> Storefront
            </Button>
          </a>
        )}
        {isProduct && (node.primary_image ? (
          <a href={node.primary_image} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm"><ImageIcon size={12} /> Image</Button>
          </a>
        ) : (
          <Link to={`/products/${node.id.replace(/^product:/, '')}/images`}>
            <Button variant="outline" size="sm"><ImageIcon size={12} /> Images</Button>
          </Link>
        ))}
      </div>

      {/* Products preview (only for hub nodes) */}
      {!isProduct && (
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-3">
            Aperçu (12 derniers)
          </h3>
          {products.isPending ? (
            <div className="flex items-center justify-center py-6">
              <Spinner size={18} className="text-[var(--color-electric-blue)]" />
            </div>
          ) : (products.data?.items ?? []).length === 0 ? (
            <div className="text-xs text-[var(--color-text-3)] py-3">Aucun produit ne correspond.</div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(products.data!.items).map(p => (
                <li key={p.id} className="glass-sm flex items-center gap-3 px-3 py-2">
                  <div className="w-10 h-10 rounded-md overflow-hidden flex items-center justify-center shrink-0 bg-[var(--color-surface-3)]">
                    {p.primary_image
                      ? <img src={p.primary_image} alt="" className="w-full h-full object-cover" loading="lazy" />
                      : <ImageIcon size={14} className="text-[var(--color-text-3)] opacity-40" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link to={`/products/${p.id}`} className="text-xs font-semibold text-[var(--color-text-1)] hover:text-[var(--color-electric-blue)] truncate block">
                      {p.name}
                    </Link>
                    <div className="text-[10px] text-[var(--color-text-3)] flex items-center gap-2">
                      {p.brand && <span>{p.brand}</span>}
                      {p.category && <span>· {p.category}</span>}
                      <span>· {fmtPercent(p.completeness_score)}</span>
                    </div>
                  </div>
                  <div className="num text-xs font-bold text-[var(--color-electric-blue)] shrink-0">
                    {p.min_price != null ? fmtMoney(p.min_price) : '—'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
