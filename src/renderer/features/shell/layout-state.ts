export type ResultPresentation = 'column' | 'overlay'
export type SidebarPresentation = 'full' | 'compact' | 'hidden'

export function resultPresentation(width: number): ResultPresentation {
  return width <= 1180 ? 'overlay' : 'column'
}

export function sidebarPresentation(width: number): SidebarPresentation {
  if (width <= 640) return 'hidden'
  if (width <= 820) return 'compact'
  return 'full'
}
