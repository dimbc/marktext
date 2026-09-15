import { describe, expect, it, vi } from 'vitest'
import { type MenuItemConstructorOptions } from 'electron'

// `help.ts` probes `${process.resourcesPath}/app-update.yml`, which only exists
// inside a packaged app; `resourcesPath` itself is typed read-only.
Object.defineProperty(process, 'resourcesPath', { value: '/resources', configurable: true })

// The menu templates import `actions/*` modules that touch `ipcMain`, `shell`
// and `electron-log` at load time, and they read labels through the i18n loader.
// Nothing here exercises those surfaces — we only inspect the menu shape — so
// stub them out and keep the slice hermetic.
vi.mock('electron', () => ({
  app: { quit: vi.fn(), clearRecentDocuments: vi.fn() },
  shell: { openExternal: vi.fn() },
  Menu: { buildFromTemplate: (template: unknown) => template, sendActionToFirstResponder: vi.fn() },
  ipcMain: { on: vi.fn(), handle: vi.fn(), emit: vi.fn() }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))
vi.mock('main_renderer/commands', () => ({ COMMANDS: new Proxy({}, { get: () => 'cmd' }) }))
vi.mock('common/filesystem', () => ({ isFile: () => false }))
// `actions/marktext` instantiates the updater at import time, which reaches for
// `app.getVersion()` of a running Electron app.
vi.mock('electron-updater', () => ({
  autoUpdater: new Proxy(
    { autoDownload: false },
    {
      get: (target: Record<string, unknown>, prop: string) =>
        prop in target ? target[prop] : vi.fn(),
      set: (target: Record<string, unknown>, prop: string, value: unknown) => {
        target[prop] = value
        return true
      }
    }
  )
}))

import configureMenu from 'main_renderer/menu/templates'

interface Item {
  id?: string
  label?: string
  type?: string
  visible?: boolean
  submenu?: Item[]
}

const keybindings = { getAccelerator: () => undefined } as never
const preferences = { getAll: () => ({}) } as never

const buildMenus = (): Item[] => configureMenu(keybindings, preferences, []) as unknown as Item[]

const flatten = (items: Item[]): Item[] =>
  items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])])

const visible = (items: Item[]): Item[] => items.filter((i) => i.visible !== false)

const idsOf = (items: Item[]): string[] =>
  items.map((i) => i.id).filter((id): id is string => typeof id === 'string')

const labelsOf = (items: Item[]): string[] =>
  items.map((i) => i.label).filter((label): label is string => typeof label === 'string')

const menuByLabel = (menus: Item[], label: string): Item => {
  const found = menus.find((m) => m.label === label)
  if (!found) throw new Error(`menu not found: ${label}`)
  return found
}

const hasAdjacentSeparators = (items: Item[]): boolean =>
  visible(items).some((item, index) => item.type === 'separator' && visible(items)[index + 1]?.type === 'separator')

describe('application menu trimming — top level', () => {
  it('keeps six entries on Windows/Linux by folding Window and Theme into View', () => {
    const menus = buildMenus()

    expect(labelsOf(menus)).toEqual([
      'menu.file.file',
      'menu.edit.edit',
      'menu.paragraph.title',
      'menu.format.format',
      'menu.view.view',
      'menu.help.help'
    ])
  })

  it('moves the whole Window and Theme menus under View without dropping a leaf', () => {
    const view = menuByLabel(buildMenus(), 'menu.view.view')
    const reachable = labelsOf(flatten([view]))

    expect(reachable).toContain('menu.window.title')
    expect(reachable).toContain('menu.theme.theme')
    expect(reachable).toContain('menu.window.minimize')
    expect(reachable).toContain('menu.window.alwaysOnTop')
    expect(reachable).toContain('menu.theme.darkThemes')
    // View keeps its own entries next to the folded ones.
    expect(reachable).toContain('menu.view.sourceCodeMode')
  })

  it('has no doubled separator anywhere in the menu bar', () => {
    for (const menu of buildMenus()) {
      expect(hasAdjacentSeparators(flatten([menu]))).toBe(false)
    }
  })
})

describe('application menu trimming — Edit', () => {
  it('folds the paragraph and find clusters into two submenus', () => {
    const labels = labelsOf(visible(menuByLabel(buildMenus(), 'menu.edit.edit').submenu ?? []))

    expect(labels).toEqual([
      'menu.edit.undo',
      'menu.edit.redo',
      'menu.edit.cut',
      'menu.edit.copy',
      'menu.edit.paste',
      'menu.edit.copyAsRich',
      'menu.edit.copyAsHtml',
      'menu.edit.pasteAsPlainText',
      'menu.edit.selectAll',
      'menu.edit.paragraphOperations',
      'menu.edit.findReplace',
      'menu.edit.lineEnding'
    ])
  })

  it('still reaches every command that used to be top level', () => {
    const reachable = labelsOf(flatten([menuByLabel(buildMenus(), 'menu.edit.edit')]))

    for (const label of [
      'menu.edit.duplicate',
      'menu.edit.createParagraph',
      'menu.edit.deleteParagraph',
      'menu.edit.find',
      'menu.edit.findNext',
      'menu.edit.findPrevious',
      'menu.edit.replace',
      'menu.edit.findInFolder',
      'menu.edit.screenshot',
      'menu.edit.lineEndingCrlf',
      'menu.edit.lineEndingLf'
    ]) {
      expect(reachable).toContain(label)
    }
  })
})

describe('application menu trimming — Paragraph', () => {
  it('shows only the frequent block types and one "more" group', () => {
    const ids = idsOf(visible(menuByLabel(buildMenus(), 'menu.paragraph.title').submenu ?? []))

    expect(ids).toEqual([
      'heading1MenuItem',
      'heading2MenuItem',
      'heading3MenuItem',
      'heading4MenuItem',
      'heading5MenuItem',
      'heading6MenuItem',
      'upgradeHeadingMenuItem',
      'degradeHeadingMenuItem',
      'tableMenuItem',
      'codeFencesMenuItem',
      'quoteBlockMenuItem',
      'orderListMenuItem',
      'bulletListMenuItem',
      'taskListMenuItem'
    ])
  })

  it('keeps every id the selection updates rely on reachable', () => {
    const reachable = idsOf(flatten([menuByLabel(buildMenus(), 'menu.paragraph.title')]))

    for (const id of [
      'looseListItemMenuItem',
      'mathBlockMenuItem',
      'htmlBlockMenuItem',
      'paragraphMenuItem',
      'horizontalLineMenuItem',
      'frontMatterMenuItem'
    ]) {
      expect(reachable).toContain(id)
    }
  })
})

describe('application menu trimming — Format', () => {
  it('shows the everyday styles and one "more" group', () => {
    const ids = idsOf(visible(menuByLabel(buildMenus(), 'menu.format.format').submenu ?? []))

    expect(ids).toEqual([
      'strongMenuItem',
      'emphasisMenuItem',
      'underlineMenuItem',
      'inlineCodeMenuItem',
      'inlineMathMenuItem',
      'strikeMenuItem'
    ])
  })

  it('keeps every id the format state update relies on reachable', () => {
    const reachable = idsOf(flatten([menuByLabel(buildMenus(), 'menu.format.format')]))

    for (const id of [
      'superscriptMenuItem',
      'subscriptMenuItem',
      'highlightMenuItem',
      'hyperlinkMenuItem',
      'imageMenuItem'
    ]) {
      expect(reachable).toContain(id)
    }
  })

  it('still offers Clear Formatting at the top level', () => {
    const labels = labelsOf(visible(menuByLabel(buildMenus(), 'menu.format.format').submenu ?? []))

    expect(labels).toContain('menu.format.clearFormat')
  })
})

describe('application menu trimming — Help', () => {
  it('folds every external link into one submenu', () => {
    const labels = labelsOf(visible(menuByLabel(buildMenus(), 'menu.help.help').submenu ?? []))

    expect(labels).toEqual([
      'menu.help.markdownReference',
      'menu.help.changelog',
      'menu.help.onlineResources',
      'menu.help.about'
    ])
  })

  it('still reaches every external link', () => {
    const reachable = labelsOf(flatten([menuByLabel(buildMenus(), 'menu.help.help')]))

    for (const label of [
      'menu.help.followUs',
      'menu.help.support',
      'menu.help.askQuestion',
      'menu.help.reportBug',
      'menu.help.viewSource',
      'menu.help.license'
    ]) {
      expect(reachable).toContain(label)
    }
  })
})

interface FakeMenuRoots {
  [rootId: string]: FakeMenuItem[]
}

interface FakeMenuItem {
  id?: string
  enabled?: boolean
  checked?: boolean
  submenu?: { items: FakeMenuItem[] }
}

describe('menu item state updates reach nested entries', () => {
  // Same shape as Electron's own surface: `getMenuItemById(id)` returns an
  // entry whose `submenu.items` hold the children.
  const makeMenu = (roots: FakeMenuRoots) =>
    ({
      getMenuItemById: (id: string) =>
        roots[id] ? { submenu: { items: roots[id] } } : undefined
    }) as unknown as Electron.Menu

  it('collectMenuItems walks into submenus', async() => {
    const { collectMenuItems } = await import('main_renderer/menu/actions/menuTree')
    const nested = { id: 'nested', enabled: true }
    const group = { submenu: { items: [nested] } }
    const root = { submenu: { items: [{ id: 'top', enabled: true }, group] } }

    const collected = collectMenuItems(root as unknown as Electron.MenuItem)

    expect(collected.map((i) => i.id)).toEqual(['top', undefined, 'nested'])
  })

  it('disables nested paragraph items too when the selection cannot be formatted', async() => {
    const { updateSelectionMenus } = await import('main_renderer/menu/actions/paragraph')
    const nested = { id: 'frontMatterMenuItem', enabled: true, checked: false }
    const menu = makeMenu({
      paragraphMenuEntry: [
        { id: 'heading1MenuItem', enabled: true, checked: false },
        { submenu: { items: [nested] } }
      ],
      formatMenuItem: []
    })

    updateSelectionMenus(menu, { affiliation: {}, isDisabled: true })

    expect(nested.enabled).toBe(false)
  })

  it('checks the nested Front Matter entry through the affiliation map', async() => {
    const { updateSelectionMenus } = await import('main_renderer/menu/actions/paragraph')
    const nested = { id: 'frontMatterMenuItem', enabled: true, checked: false }
    const menu = makeMenu({
      paragraphMenuEntry: [{ submenu: { items: [nested] } }],
      formatMenuItem: []
    })

    updateSelectionMenus(menu, { affiliation: { frontmatter: true } })

    expect(nested.checked).toBe(true)
  })

  it('checks a nested inline style through updateFormatMenu', async() => {
    const { updateFormatMenu } = await import('main_renderer/menu/actions/format')
    const nested = { id: 'highlightMenuItem', checked: false }
    const menu = makeMenu({ formatMenuItem: [{ submenu: { items: [nested] } }] })

    updateFormatMenu(menu, { mark: true })

    expect(nested.checked).toBe(true)
  })
})
