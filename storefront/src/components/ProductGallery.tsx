import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, X as XIcon, ZoomIn } from 'lucide-react'
import { categoryIcon } from '@/lib/format'

interface ProductGalleryProps {
  images: { url: string; alt: string | null }[]
  productName: string
  category: string | null
}

export function ProductGallery({ images, productName, category }: ProductGalleryProps) {
  const [active, setActive] = useState(0)
  const [lensVisible, setLensVisible] = useState(false)
  const [lens, setLens] = useState({ x: 50, y: 50 })  // percent
  const [fullscreen, setFullscreen] = useState(false)
  const heroRef = useRef<HTMLDivElement>(null)

  const current = images[active]

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width)  * 100
    const y = ((e.clientY - r.top)  / r.height) * 100
    setLens({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) })
  }

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (fullscreen) {
        if (e.key === 'Escape') setFullscreen(false)
        if (e.key === 'ArrowLeft')  setActive(a => (a - 1 + images.length) % images.length)
        if (e.key === 'ArrowRight') setActive(a => (a + 1) % images.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, images.length])

  if (!current) {
    return (
      <div className="aspect-square glass flex flex-col items-center justify-center gap-3 no-img-placeholder">
        <div className="text-6xl">{categoryIcon(category)}</div>
        <span className="text-xs text-[var(--color-text-3)] uppercase tracking-widest font-bold">
          {category ?? 'Produit'} — pas d’image
        </span>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3 lg:sticky lg:top-32">
        {/* Hero with zoom-on-hover */}
        <div
          ref={heroRef}
          className="relative aspect-square glass overflow-hidden no-img-placeholder cursor-zoom-in"
          onMouseEnter={() => setLensVisible(true)}
          onMouseLeave={() => setLensVisible(false)}
          onMouseMove={onMouseMove}
          onClick={() => setFullscreen(true)}
          role="button"
          tabIndex={0}
          aria-label="Agrandir l’image"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFullscreen(true) }}}
        >
          <motion.img
            key={current.url}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            src={current.url}
            alt={current.alt || productName}
            className="absolute inset-0 w-full h-full object-contain p-6 transition-transform duration-300 ease-out"
            style={lensVisible ? {
              transformOrigin: `${lens.x}% ${lens.y}%`,
              transform: 'scale(1.8)',
            } : undefined}
          />

          {/* Zoom hint badge */}
          <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-[var(--color-jet-black)]/60 backdrop-blur flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
            <ZoomIn size={16} className="text-[var(--color-neon-yellow)]" />
          </div>

          {/* Image counter */}
          {images.length > 1 && (
            <div className="absolute bottom-3 right-3 num text-[10px] font-bold text-[var(--color-text-1)] bg-[var(--color-jet-black)]/70 backdrop-blur px-2 py-1 rounded-md">
              {active + 1} / {images.length}
            </div>
          )}
        </div>

        {/* Thumbnail strip */}
        {images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {images.map((img, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Image ${i + 1}`}
                className={`relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all no-img-placeholder ${
                  i === active
                    ? 'border-[var(--color-electric-blue)] glow-brand'
                    : 'border-[var(--color-surface-4)] hover:border-[var(--color-surface-3)]'
                }`}
              >
                <img src={img.url} alt={img.alt || ''} className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen lightbox */}
      <AnimatePresence>
        {fullscreen && (
          <motion.div
            className="fixed inset-0 z-[100] bg-[var(--color-jet-black)]/95 backdrop-blur-md flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFullscreen(false)}
            role="dialog"
            aria-modal="true"
            aria-label={`${productName} — image agrandie`}
          >
            <motion.img
              key={current.url}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              src={current.url}
              alt={current.alt || productName}
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-2xl"
              onClick={e => e.stopPropagation()}
            />

            <button
              type="button"
              onClick={() => setFullscreen(false)}
              aria-label="Fermer"
              className="fixed top-4 right-4 w-12 h-12 rounded-full bg-[var(--color-surface-2)] hover:bg-[var(--color-hot-pink)]/20 flex items-center justify-center transition-colors"
            >
              <XIcon size={20} className="text-[var(--color-text-1)]" />
            </button>

            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActive(a => (a - 1 + images.length) % images.length) }}
                  aria-label="Image précédente"
                  className="fixed left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-[var(--color-surface-2)] hover:bg-[var(--color-electric-blue)]/20 flex items-center justify-center transition-colors"
                >
                  <ChevronLeft size={20} className="text-[var(--color-text-1)]" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActive(a => (a + 1) % images.length) }}
                  aria-label="Image suivante"
                  className="fixed right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-[var(--color-surface-2)] hover:bg-[var(--color-electric-blue)]/20 flex items-center justify-center transition-colors"
                >
                  <ChevronRight size={20} className="text-[var(--color-text-1)]" />
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
