/**
 * File actions menu anchored to the side bar's leading icon.
 *
 * File operations normally live in the application menu behind the title bar.
 * Attaching them to the side bar keeps them next to the file tree, where users
 * already look while managing files. The menu reuses the shared overlay engine
 * (`./overlay`) and only describes content.
 *
 * The Pandoc converters are intentionally absent: their format table lives in
 * the main process, and duplicating its labels here would drift out of sync.
 */
import bus from '../bus'
import { t } from '../i18n'
import {
  ICONS,
  acceleratorFor,
  attachSubmenu,
  closeOverlay,
  executeCommand,
  iconButton,
  openOverlay,
  rowEl,
  separatorEl,
  textItem
} from './overlay'

/** Command ids referenced by this menu — asserted by the unit test against the
 *  command center so a rename surfaces immediately. */
export const SIDE_BAR_FILE_COMMAND_IDS = [
  'file.new-tab',
  'file.open-file',
  'file.open-folder',
  'file.save',
  'file.save-as',
  'file.import-file',
  'file.print',
  'file.move-file',
  'file.rename-file',
  'file.toggle-auto-save',
  'file.preferences',
  'file.close-tab',
  'file.close-window',
  'file.quit'
] as const

type ExportType = 'styledHtml' | 'pdf'

// Matching the command implementations, which wait a tick so the export dialog
// can take focus away from the editor.
const requestExport = (type: ExportType): void => {
  window.setTimeout(() => bus.emit('showExportDialog', type), 50)
}

const buildExportPanel = (sub: HTMLElement): void => {
  sub.appendChild(textItem({
    label: t('menu.file.exportHtml'),
    onClick: () => requestExport('styledHtml')
  }))
  sub.appendChild(textItem({
    label: t('menu.file.exportPdf'),
    onClick: () => requestExport('pdf')
  }))
}

const buildMorePanel = (sub: HTMLElement): void => {
  sub.appendChild(textItem({
    label: t('menu.file.moveTo'),
    accel: acceleratorFor('file.move-file'),
    onClick: () => executeCommand('file.move-file')
  }))
  sub.appendChild(textItem({
    label: t('menu.file.rename'),
    accel: acceleratorFor('file.rename-file'),
    onClick: () => executeCommand('file.rename-file')
  }))
  sub.appendChild(textItem({
    label: t('menu.file.autoSave'),
    accel: acceleratorFor('file.toggle-auto-save'),
    onClick: () => executeCommand('file.toggle-auto-save')
  }))
  sub.appendChild(separatorEl())
  sub.appendChild(textItem({
    label: t('menu.file.preferences'),
    accel: acceleratorFor('file.preferences'),
    onClick: () => executeCommand('file.preferences')
  }))
  sub.appendChild(separatorEl())
  sub.appendChild(textItem({
    label: t('menu.file.closeTab'),
    accel: acceleratorFor('file.close-tab'),
    onClick: () => executeCommand('file.close-tab')
  }))
  sub.appendChild(textItem({
    label: t('menu.file.closeWindow'),
    accel: acceleratorFor('file.close-window'),
    onClick: () => executeCommand('file.close-window')
  }))
  sub.appendChild(textItem({
    label: t('menu.file.quit'),
    accel: acceleratorFor('file.quit'),
    onClick: () => executeCommand('file.quit')
  }))
}

const buildFileMenu = (root: HTMLElement): void => {
  const shortcuts: Array<[string, string, string]> = [
    [t('menu.file.newTab'), 'file.new-tab', 'newTab'],
    [t('menu.file.openFile'), 'file.open-file', 'openFile'],
    [t('menu.file.openFolder'), 'file.open-folder', 'openFolder'],
    [t('menu.file.save'), 'file.save', 'save'],
    [t('menu.file.saveAs'), 'file.save-as', 'saveAs']
  ]
  const buttons = shortcuts.map(([label, commandId, icon]) => iconButton({
    icon,
    hint: label,
    accel: acceleratorFor(commandId),
    onClick: () => executeCommand(commandId)
  }))

  // Icon-only like the editor menu's "more" button: a label here would need a
  // new string in every supported locale.
  const moreBtn = document.createElement('button')
  moreBtn.className = 'mt-ctx-btn'
  moreBtn.type = 'button'
  moreBtn.innerHTML = '<span class="mt-ctx-ic">' + ICONS.more + '</span>'
  moreBtn.addEventListener('mousedown', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
  })
  attachSubmenu(moreBtn, buildMorePanel)
  buttons.push(moreBtn)

  root.appendChild(rowEl(buttons))

  root.appendChild(separatorEl())

  root.appendChild(textItem({
    label: t('menu.file.import'),
    onClick: () => executeCommand('file.import-file')
  }))

  const exportEntry = textItem({
    label: t('menu.file.export'),
    trailing: 'chevron'
  })
  attachSubmenu(exportEntry, buildExportPanel)
  root.appendChild(exportEntry)

  root.appendChild(textItem({
    label: t('menu.file.print'),
    accel: acceleratorFor('file.print'),
    onClick: () => executeCommand('file.print')
  }))
}

let open = false

/** Open (or close, when already open) the file menu next to `anchor`. */
export const openSideBarFileMenu = (anchor: DOMRect): void => {
  if (open) {
    closeOverlay()
    return
  }
  openOverlay({
    x: anchor.right + 4,
    y: anchor.top,
    build: buildFileMenu,
    onClose: () => {
      open = false
    }
  })
  // Assigned after opening: `openOverlay` closes any previous overlay first,
  // which would run the hook and clear this flag again.
  open = true
}

export const isSideBarFileMenuOpen = (): boolean => open
