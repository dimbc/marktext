import type { MenuItem } from 'electron'

/**
 * Depth-first list of every descendant of a menu entry.
 *
 * Menu templates fold rarely used commands into nested submenus to keep the
 * menu bar short, so enabling/disabling/checking has to reach those nested
 * items instead of stopping at the direct children.
 *
 * @param entry The menu entry (e.g. the "Paragraph" or "Format" root item).
 */
export const collectMenuItems = (entry: MenuItem): MenuItem[] => {
  const result: MenuItem[] = []
  const walk = (items: readonly MenuItem[]): void => {
    items.forEach((item) => {
      result.push(item)
      if (item.submenu) {
        walk(item.submenu.items)
      }
    })
  }

  if (entry.submenu) {
    walk(entry.submenu.items)
  }
  return result
}
