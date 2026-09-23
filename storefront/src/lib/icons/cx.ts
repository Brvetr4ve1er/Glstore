/**
 * Local class merger.
 *
 * This is deliberately NOT `cn` from `@/lib/format`. `format.ts` imports this
 * directory so that `categoryIcon()` keeps working for its seven existing
 * callers; importing `cn` back out of `format` would close an import cycle
 * through a module that runs at bootstrap. Four lines here buys a strictly
 * one-directional graph: `format` → `icons` → `taxonomy`.
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cx(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
