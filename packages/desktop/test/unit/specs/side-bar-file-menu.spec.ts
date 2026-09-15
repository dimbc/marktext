import { afterEach, describe, expect, it, vi } from 'vitest'

// The side bar file menu reuses the overlay engine, so these specs focus on
// what the menu itself owns: every referenced command id must exist (the
// command center throws for unknown ids), the panel must hold the expected
// rows, clicking an entry must dismiss it, and repeated clicks on the icon
// must toggle rather than stack panels.

import commands from '@/commands'
import bus from '@/bus'
import { SIDE_BAR_FILE_COMMAND_IDS, isSideBarFileMenuOpen, openSideBarFileMenu } from '@/contextMenu/sideBarFileMenu'
import { closeOverlay } from '@/contextMenu/overlay'

const anchor = { right: 40, top: 60 } as DOMRect

const cleanUp = () => {
  closeOverlay()
  document.querySelectorAll('.mt-ctx').forEach((el) => el.remove())
}

describe('side bar file menu', () => {
  afterEach(cleanUp)

  it('only references ids that exist in the command center', () => {
    const knownIds = new Set(commands.map((c) => c.id))
    const missing = SIDE_BAR_FILE_COMMAND_IDS.filter((id) => !knownIds.has(id))
    expect(missing).toEqual([])
  })

  it('opens one panel with a shortcut row, the file operations and no duplicates', () => {
    openSideBarFileMenu(anchor)
    const panels = document.querySelectorAll('.mt-ctx')
    expect(panels.length).toBe(1)
    expect(isSideBarFileMenuOpen()).toBe(true)

    const firstRow = panels[0].querySelector('.mt-ctx-row')
    // Five shortcuts plus the hover-expanded "more" button.
    expect(firstRow?.querySelectorAll('.mt-ctx-btn').length).toBe(6)
    expect(panels[0].querySelectorAll('.mt-ctx-item').length).toBe(3)
  })

  it('runs the referenced command and dismisses the panel', () => {
    openSideBarFileMenu(anchor)
    const panel = document.querySelector('.mt-ctx') as HTMLElement

    // Third shortcut is "Open Folder", whose command posts over IPC.
    const openFolder = panel.querySelectorAll('.mt-ctx-btn')[2] as HTMLButtonElement
    const emit = vi.fn()
    bus.on('cmd::execute', emit)
    openFolder.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(emit).toHaveBeenCalledWith('file.open-folder')
    expect(document.querySelector('.mt-ctx')).toBeNull()
    bus.off('cmd::execute', emit)
  })

  it('toggles instead of stacking when the trigger is clicked again', () => {
    openSideBarFileMenu(anchor)
    expect(document.querySelectorAll('.mt-ctx').length).toBe(1)
    expect(isSideBarFileMenuOpen()).toBe(true)

    openSideBarFileMenu(anchor)
    expect(document.querySelectorAll('.mt-ctx').length).toBe(0)
    expect(isSideBarFileMenuOpen()).toBe(false)
  })

  it('resets its state when dismissed from the outside', () => {
    openSideBarFileMenu(anchor)
    expect(isSideBarFileMenuOpen()).toBe(true)
    closeOverlay()
    expect(isSideBarFileMenuOpen()).toBe(false)
  })
})
