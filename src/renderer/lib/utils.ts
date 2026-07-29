import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn/ui 的类名合并工具。
 * clsx 处理条件类名，tailwind-merge 消除冲突（后写的 `p-4` 覆盖先写的 `p-2`）。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
