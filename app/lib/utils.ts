import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Join class names, letting a later Tailwind utility override an earlier one (shadcn-vue's helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
