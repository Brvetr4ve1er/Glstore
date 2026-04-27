/**
 * Image Review — Phase 9.
 *
 * Two modes:
 *   1) Per-product: /products/:id/images
 *      Reviewer sees every PENDING image suggested by full_intel for one
 *      product. Approve → STORED (optional set-as-primary), Reject → DELETED.
 *
 *   2) Global queue: /images
 *      Cross-catalog queue of every pending image, paginated. Same actions.
 *
 * Q4 contract: "URL today, manual confirmation for R2 download". We do NOT
 * upload to R2 from here — full_intel inserts the URL as PENDING/SCRAPED;
 * approving just flips status to STORED so the storefront can render it.
 * (Future: a downloader-worker can pick STORED+SCRAPED rows and push them
 * to R2 with checksums and dimensions.)
 */
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Check, X as XIcon, ImageIcon, Star, ExternalLink, Layers,
  AlertTriangle,
} from 'lucide-react'
import {
  fetchProductImages, approveImage, rejectImage,
  fetchPendingImages, fetchPendingImagesSummary, fetchProduct,
  type ProductImage,
} from '@/lib/api'
import { Button, Card, EmptyState, PageHeader, Spinner, StatCard } from '@/components/ui'
import { fmtDate } from '@/lib/utils'


// ── Per-product review ──────────────────────────────────────────────────

export default function ProductImageReview() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <EmptyState title="Produit introuvable" />

  return <PerProduct productId={id} />
}


function PerProduct({ productId }: { productId: string }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'PENDING' | 'STORED' | 'all'>('PENDING')

  const product = useQuery({
    queryKey: ['product', productId],
    queryFn: () => fetchProduct(productId),
  })

  const images = useQuery({
    queryKey: ['product-images', productId, filter],
    queryFn: () => fetchProductImages(productId, filter === 'all' ? undefined : filter),
  })

  const approveMut = useMutation({
    mutationFn: (args: { imageId: string; primary: boolean }) =>
      approveImage(productId, args.imageId, { is_primary: args.primary }),
    onSuccess: (_r, args) => {
      toast.success(args.primary ? 'Image confirmée comme image principale' : 'Image confirmée')
      qc.invalidateQueries({ queryKey: ['product-images', productId] })
      qc.invalidateQueries({ queryKey: ['product', productId] })
      qc.invalidateQueries({ queryKey: ['pending-images-summary'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rejectMut = useMutation({
    mutationFn: (imageId: string) => rejectImage(productId, imageId),
    onSuccess: () => {
      toast.success('Image rejetée')
      qc.invalidateQueries({ queryKey: ['product-images', productId] })
      qc.invalidateQueries({ queryKey: ['pending-images-summary'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const counts = images.data?.counts
  const items = images.data?.items ?? []

  return (
    <div className="flex flex-col gap-5 page-enter">
      {/* Back + header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          to={`/products/${productId}`}
          className="flex items-center gap-2 text-sm text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] transition-colors w-fit"
        >
          <ArrowLeft size={14} /> Retour au produit
        </Link>
        <Link to="/images" className="text-xs text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] flex items-center gap-1.5">
          <Layers size={12} /> File globale
        </Link>
      </div>

      <PageHeader
        title="Validation des images"
        sub={
          product.data
            ? `${product.data.name} · ${product.data.sku}`
            : 'Chargement…'
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterPill
          active={filter === 'PENDING'}
          label={`En attente${counts ? ` · ${counts.pending}` : ''}`}
          onClick={() => setFilter('PENDING')}
        />
        <FilterPill
          active={filter === 'STORED'}
          label={`Confirmées${counts ? ` · ${counts.stored}` : ''}`}
          onClick={() => setFilter('STORED')}
        />
        <FilterPill
          active={filter === 'all'}
          label={`Toutes${counts ? ` · ${counts.total}` : ''}`}
          onClick={() => setFilter('all')}
        />
      </div>

      {/* Hint */}
      {filter === 'PENDING' && items.length > 0 && (
        <div className="glass-sm p-3 flex items-start gap-2 text-xs text-[var(--color-text-2)]">
          <AlertTriangle size={14} className="text-[var(--color-neon-yellow)] mt-0.5 shrink-0" />
          <p>
            Ces images ont été proposées par <code className="text-[10px] bg-[var(--color-surface-3)] px-1 rounded">full_intel</code>
            {' '}depuis le scraper. Validez celles qui correspondent au produit. Ajoutez-en une comme <strong>image principale</strong> pour qu'elle apparaisse sur la fiche client.
          </p>
        </div>
      )}

      {/* Grid */}
      {images.isPending ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} className="text-[var(--color-electric-blue)]" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Rien à valider"
          desc={filter === 'PENDING' ? "Aucune image en attente. Lancez 'Full Intel' sur le produit pour en générer." : 'Aucune image dans cette catégorie.'}
          icon={<ImageIcon size={24} className="text-[var(--color-text-3)]" />}
          action={
            <Link to={`/products/${productId}`}>
              <Button variant="outline" size="sm">Retour au produit</Button>
            </Link>
          }
        />
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          layout
        >
          <AnimatePresence>
            {items.map(img => (
              <ImageCard
                key={img.id}
                img={img}
                onApprove={(primary) => approveMut.mutate({ imageId: img.id, primary })}
                onReject={() => rejectMut.mutate(img.id)}
                pending={approveMut.isPending || rejectMut.isPending}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  )
}


function ImageCard({
  img, onApprove, onReject, pending,
}: {
  img: ProductImage
  onApprove: (primary: boolean) => void
  onReject: () => void
  pending: boolean
}) {
  const [broken, setBroken] = useState(false)
  const isPending = img.status === 'PENDING'
  const isStored  = img.status === 'STORED'
  const isDeleted = img.status === 'DELETED'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="glass overflow-hidden flex flex-col"
    >
      {/* Image area */}
      <div className="aspect-square bg-[var(--color-surface-3)] flex items-center justify-center relative overflow-hidden">
        {broken ? (
          <div className="flex flex-col items-center gap-2 text-[var(--color-text-3)] text-xs">
            <AlertTriangle size={32} />
            URL inaccessible
          </div>
        ) : (
          <img
            src={img.url}
            alt={img.alt_text ?? ''}
            className="w-full h-full object-contain p-3"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        )}
        {/* Status pip */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <StatusBadge status={img.status} />
          {img.is_primary && (
            <span className="badge bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)]">
              <Star size={10} /> Principale
            </span>
          )}
        </div>
        {/* Source pip */}
        <div className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-widest text-[var(--color-text-3)] bg-[var(--color-surface-1)]/80 px-2 py-0.5 rounded">
          {img.source}
        </div>
      </div>

      {/* Meta */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <a
          href={img.url} target="_blank" rel="noopener noreferrer"
          className="text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)] flex items-center gap-1 truncate"
        >
          <ExternalLink size={10} className="shrink-0" />
          <span className="truncate font-mono">{img.url}</span>
        </a>
        {img.alt_text && (
          <p className="text-[11px] text-[var(--color-text-2)] line-clamp-2 leading-snug">{img.alt_text}</p>
        )}
        <div className="text-[10px] text-[var(--color-text-3)] flex items-center gap-2 mt-auto">
          {img.width && img.height && <span className="num">{img.width}×{img.height}</span>}
          <span>· {fmtDate(img.created_at)}</span>
        </div>
      </div>

      {/* Actions */}
      {isPending && (
        <div className="border-t border-[var(--color-surface-4)] p-3 grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" loading={pending} onClick={() => onReject()} title="Rejeter">
            <XIcon size={12} /> Rejeter
          </Button>
          <Button variant="ghost" size="sm" loading={pending} onClick={() => onApprove(false)} title="Approuver (galerie)">
            <Check size={12} /> Approuver
          </Button>
          <Button variant="accent" size="sm" loading={pending} onClick={() => onApprove(true)} title="Approuver comme image principale">
            <Star size={12} /> Principale
          </Button>
        </div>
      )}
      {isStored && (
        <div className="border-t border-[var(--color-surface-4)] p-3 flex justify-end gap-2">
          {!img.is_primary && (
            <Button variant="ghost" size="sm" loading={pending} onClick={() => onApprove(true)}>
              <Star size={12} /> Définir comme principale
            </Button>
          )}
          <Button variant="ghost" size="sm" loading={pending} onClick={() => onReject()}>
            <XIcon size={12} /> Retirer
          </Button>
        </div>
      )}
      {isDeleted && (
        <div className="border-t border-[var(--color-surface-4)] p-3 text-[10px] text-[var(--color-text-3)] italic text-center">
          Rejetée — n'apparaîtra plus.
        </div>
      )}
    </motion.div>
  )
}


function FilterPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
        active
          ? 'bg-[var(--color-electric-blue)]/20 border-[var(--color-electric-blue)] text-[var(--color-electric-blue)]'
          : 'border-[var(--color-surface-4)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)]'
      }`}
    >
      {label}
    </button>
  )
}


function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PENDING: { bg: 'var(--color-neon-yellow)', fg: 'var(--color-jet-black)', label: 'En attente' },
    STORED:  { bg: 'var(--color-success)',     fg: 'white',                  label: 'Confirmée' },
    FAILED:  { bg: 'var(--color-hot-pink)',    fg: 'white',                  label: 'Échec' },
    DELETED: { bg: 'var(--color-surface-4)',   fg: 'var(--color-text-3)',    label: 'Rejetée' },
    UPLOADING: { bg: 'var(--color-electric-blue)', fg: 'white',              label: 'Upload…' },
  }
  const m = map[status] ?? { bg: 'var(--color-surface-4)', fg: 'var(--color-text-3)', label: status }
  return (
    <span className="badge" style={{ background: m.bg, color: m.fg }}>
      {m.label}
    </span>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// Global pending queue page
// ─────────────────────────────────────────────────────────────────────────

export function GlobalImageQueue() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 24

  const summary = useQuery({
    queryKey: ['pending-images-summary'],
    queryFn: fetchPendingImagesSummary,
    refetchInterval: 30_000,
  })

  const queue = useQuery({
    queryKey: ['pending-images', page],
    queryFn: () => fetchPendingImages(page, PAGE_SIZE),
  })

  const approveMut = useMutation({
    mutationFn: (args: { productId: string; imageId: string; primary: boolean }) =>
      approveImage(args.productId, args.imageId, { is_primary: args.primary }),
    onSuccess: () => {
      toast.success('Image confirmée')
      qc.invalidateQueries({ queryKey: ['pending-images'] })
      qc.invalidateQueries({ queryKey: ['pending-images-summary'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rejectMut = useMutation({
    mutationFn: (args: { productId: string; imageId: string }) =>
      rejectImage(args.productId, args.imageId),
    onSuccess: () => {
      toast.success('Image rejetée')
      qc.invalidateQueries({ queryKey: ['pending-images'] })
      qc.invalidateQueries({ queryKey: ['pending-images-summary'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="flex flex-col gap-5 page-enter">
      <PageHeader
        title="File des images"
        sub="Validation manuelle des images proposées par Full Intel"
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="En attente"
          value={summary.data?.pending ?? 0}
          icon={<ImageIcon size={16} />}
          accent="var(--color-neon-yellow)"
          loading={summary.isPending}
        />
        <StatCard
          label="Confirmées 24 h"
          value={summary.data?.approved_24h ?? 0}
          icon={<Check size={16} />}
          accent="var(--color-success)"
          loading={summary.isPending}
        />
        <StatCard
          label="Rejetées 24 h"
          value={summary.data?.rejected_24h ?? 0}
          icon={<XIcon size={16} />}
          accent="var(--color-hot-pink)"
          loading={summary.isPending}
        />
      </div>

      {/* Top products with pending */}
      {(summary.data?.top_products?.length ?? 0) > 0 && (
        <Card>
          <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-3">
            Produits avec le plus d'images en attente
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.data!.top_products.slice(0, 12).map(p => (
              <Link
                key={p.id}
                to={`/products/${p.id}/images`}
                className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-surface-3)] hover:bg-[var(--color-electric-blue)]/15 hover:text-[var(--color-electric-blue)] transition-colors flex items-center gap-2"
              >
                <span className="num text-[var(--color-neon-yellow)] font-black">{p.pending}</span>
                <span className="truncate max-w-[200px]">{p.name}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Queue grid */}
      {queue.isPending ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size={24} className="text-[var(--color-electric-blue)]" />
        </div>
      ) : (queue.data?.items ?? []).length === 0 ? (
        <EmptyState
          title="File vide"
          desc="Toutes les images ont été validées. Beau travail."
          icon={<Check size={24} className="text-[var(--color-success)]" />}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {queue.data!.items.map(item => (
              <QueueItemCard
                key={item.id}
                item={item}
                pending={approveMut.isPending || rejectMut.isPending}
                onApprove={(primary) => approveMut.mutate({ productId: item.product_id, imageId: item.id, primary })}
                onReject={() => rejectMut.mutate({ productId: item.product_id, imageId: item.id })}
              />
            ))}
          </div>

          {queue.data!.total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 mt-2">
              <span className="text-xs text-[var(--color-text-3)]">
                Page {queue.data!.page} · {queue.data!.total} en attente au total
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  Précédent
                </Button>
                <Button variant="outline" size="sm"
                  disabled={(queue.data!.items.length) < PAGE_SIZE}
                  onClick={() => setPage(p => p + 1)}>
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}


function QueueItemCard({
  item, pending, onApprove, onReject,
}: {
  item: { id: string; product_id: string; url: string; product_name: string; sku: string; brand: string | null; category: string | null; alt_text: string | null; created_at: string }
  pending: boolean
  onApprove: (primary: boolean) => void
  onReject: () => void
}) {
  const [broken, setBroken] = useState(false)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="glass overflow-hidden flex flex-col"
    >
      <div className="aspect-square bg-[var(--color-surface-3)] flex items-center justify-center overflow-hidden">
        {broken ? (
          <div className="flex flex-col items-center gap-2 text-[var(--color-text-3)] text-xs">
            <AlertTriangle size={28} />
            URL inaccessible
          </div>
        ) : (
          <img src={item.url} alt={item.alt_text ?? ''} loading="lazy"
               onError={() => setBroken(true)}
               className="w-full h-full object-contain p-3" />
        )}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <Link to={`/products/${item.product_id}`}
              className="text-xs font-bold text-[var(--color-text-1)] hover:text-[var(--color-electric-blue)] truncate">
          {item.product_name}
        </Link>
        <div className="text-[10px] text-[var(--color-text-3)] flex items-center gap-2 truncate">
          {item.brand && <span className="font-bold">{item.brand}</span>}
          {item.category && <span>· {item.category}</span>}
          <span className="num">· {item.sku}</span>
        </div>
        <div className="text-[10px] text-[var(--color-text-3)]">
          {fmtDate(item.created_at)}
        </div>
      </div>
      <div className="border-t border-[var(--color-surface-4)] p-2 grid grid-cols-3 gap-1">
        <Button variant="outline" size="sm" loading={pending} onClick={onReject}>
          <XIcon size={11} />
        </Button>
        <Button variant="ghost" size="sm" loading={pending} onClick={() => onApprove(false)}>
          <Check size={11} />
        </Button>
        <Button variant="accent" size="sm" loading={pending} onClick={() => onApprove(true)}>
          <Star size={11} />
        </Button>
      </div>
    </motion.div>
  )
}
