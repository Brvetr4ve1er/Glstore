/**
 * ScrollReveal — AOS-style reveal-on-scroll using Framer Motion.
 *
 * Honors prefers-reduced-motion automatically (Framer Motion's
 * MotionConfig in App.tsx flips reduced motion).
 */
import { motion, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

const VARIANTS: Record<string, Variants> = {
  'fade-up': {
    hidden: { opacity: 0, y: 18 },
    show:   { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
  },
  'fade-up-sm': {
    hidden: { opacity: 0, y: 8 },
    show:   { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  },
  'fade-in': {
    hidden: { opacity: 0 },
    show:   { opacity: 1, transition: { duration: 0.5 } },
  },
  'zoom-in': {
    hidden: { opacity: 0, scale: 0.96 },
    show:   { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  },
  'slide-right': {
    hidden: { opacity: 0, x: -16 },
    show:   { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  },
}

export type RevealVariant = keyof typeof VARIANTS

export function ScrollReveal({
  children, variant = 'fade-up', delay = 0, className, once = true, amount = 0.2,
}: {
  children: ReactNode
  variant?: RevealVariant
  delay?: number
  className?: string
  once?: boolean
  amount?: number
}) {
  const v = VARIANTS[variant]
  return (
    <motion.div
      className={className}
      variants={v}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  )
}

/** Container variant for staggering children (each child should have its own
 *  variant attached or use ScrollReveal individually). */
export const STAGGER_CONTAINER: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.04 },
  },
}

export const STAGGER_ITEM: Variants = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 26 } },
}
