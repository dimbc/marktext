/**
 * Editor context menu — a custom HTML overlay for the WYSIWYG editor surface.
 *
 * MarkText ships no context menu for the editor body itself (side bar, tabs and
 * the source-code pane have their own). This module fills that gap with a
 * compact overlay: clipboard icons, inline formatting icons, the three most
 * frequent insert actions, a structural row and a hover-expanded sub panel.
 *
 * Everything is plain DOM so the overlay can be tested without mounting a
 * component. Actions are dispatched through the existing bus/command-center
 * pathways — the menu owns no editor logic of its own. All colors come from
 * the theme's :root CSS variables, so theme switches need no JS involvement.
 */
import bus from '../bus'
import { t } from '../i18n'
import { isOsx } from '@/util'
import {
  ICONS,
  acceleratorFor,
  attachSubmenu,
  executeCommand,
  iconButton,
  openOverlay,
  rowEl,
  separatorEl,
  textItem
} from './overlay'

/** Command ids referenced by this menu. Exported so tests can assert every id
 *  exists in the command center — a renamed command must break the test, not
 *  silently throw at right-click time. */
export const CONTEXT_MENU_COMMAND_IDS = [
  'format.strong',
  'format.emphasis',
  'format.strike',
  'format.inline-code',
  'format.hyperlink',
  'paragraph.code-fence',
  'paragraph.table',
  'format.image',
  'paragraph.quote-block',
  'paragraph.bullet-list',
  'paragraph.order-list',
  'paragraph.task-list',
  'paragraph.horizontal-line',
  'paragraph.heading-1',
  'paragraph.heading-2',
  'paragraph.heading-3',
  'paragraph.math-formula',
  'format.inline-math',
  'paragraph.html-block',
  'edit.find',
  'paragraph.reset-paragraph'
] as const

export { clampPosition, formatAccelerator } from './overlay'

const hasSelection = (): boolean => {
  try {
    const selection = window.getSelection()
    return !!(selection && selection.rangeCount && String(selection.toString()).length > 0)
  } catch {
    return false
  }
}

let initialized = false

const initEditorContextMenu = (): void => {
  if (initialized || typeof document === 'undefined') return
  initialized = true

  const buildMorePanel = (sub: HTMLElement): void => {
    // No group headings on purpose: the entries are self-descriptive and
    // adding them would require new locale keys for no reader benefit.
    ;(['1', '2', '3'] as const).forEach((n) => {
      sub.appendChild(textItem({
        label: t('menu.paragraph.heading' + n),
        accel: acceleratorFor('paragraph.heading-' + n),
        onClick: () => executeCommand('paragraph.heading-' + n)
      }))
    })
    sub.appendChild(separatorEl())
    sub.appendChild(textItem({
      label: t('menu.paragraph.mathBlock'),
      accel: acceleratorFor('paragraph.math-formula'),
      onClick: () => executeCommand('paragraph.math-formula')
    }))
    sub.appendChild(textItem({
      label: t('menu.format.inlineMath'),
      accel: acceleratorFor('format.inline-math'),
      onClick: () => executeCommand('format.inline-math')
    }))
    sub.appendChild(textItem({
      label: t('menu.paragraph.htmlBlock'),
      onClick: () => executeCommand('paragraph.html-block')
    }))
    sub.appendChild(separatorEl())
    sub.appendChild(textItem({
      label: t('menu.edit.find'),
      accel: acceleratorFor('edit.find'),
      onClick: () => executeCommand('edit.find')
    }))
    sub.appendChild(textItem({
      label: t('menu.paragraph.paragraph'),
      onClick: () => executeCommand('paragraph.reset-paragraph')
    }))
  }

  const buildPanel = (root: HTMLElement): void => {
    const selectionEmpty = !hasSelection()

    // Clipboard row. Cut reuses the rich-text copy pathway (same as the
    // Edit menu) and removes the selection afterwards.
    root.appendChild(rowEl([
      iconButton({
        icon: 'cut',
        hint: t('menu.edit.cut'),
        accel: isOsx ? 'Cmd+X' : 'Ctrl+X',
        disabled: selectionEmpty,
        onClick: () => {
          bus.emit('copyAsRich')
          setTimeout(() => {
            try {
              document.execCommand('delete')
            } catch {
              // Older engines may reject execCommand; the copy already happened.
            }
          }, 20)
        }
      }),
      iconButton({
        icon: 'copy',
        hint: t('menu.edit.copy'),
        accel: isOsx ? 'Cmd+C' : 'Ctrl+C',
        disabled: selectionEmpty,
        onClick: () => bus.emit('copyAsRich')
      }),
      iconButton({
        icon: 'paste',
        hint: t('menu.edit.pasteAsPlainText'),
        accel: isOsx ? 'Cmd+Shift+V' : 'Ctrl+Shift+V',
        onClick: () => bus.emit('pasteAsPlainText')
      }),
      iconButton({
        icon: 'selall',
        hint: t('menu.edit.selectAll'),
        accel: isOsx ? 'Cmd+A' : 'Ctrl+A',
        onClick: () => bus.emit('selectAll')
      })
    ]))

    root.appendChild(separatorEl())

    // Inline formatting row.
    const inlineFormats: Array<[string, string, string]> = [
      [t('menu.format.bold'), 'format.strong', 'bold'],
      [t('menu.format.italic'), 'format.emphasis', 'italic'],
      [t('menu.format.strikethrough'), 'format.strike', 'strike'],
      [t('menu.format.inlineCode'), 'format.inline-code', 'code'],
      [t('menu.format.hyperlink'), 'format.hyperlink', 'link']
    ]
    root.appendChild(rowEl(inlineFormats.map(([label, commandId, icon]) => iconButton({
      icon,
      hint: label,
      accel: acceleratorFor(commandId),
      onClick: () => executeCommand(commandId)
    }))))

    root.appendChild(separatorEl())

    // High-frequency inserts.
    const highFrequency: Array<[string, string]> = [
      [t('menu.paragraph.codeFences'), 'paragraph.code-fence'],
      [t('menu.paragraph.table'), 'paragraph.table'],
      [t('menu.format.image'), 'format.image']
    ]
    highFrequency.forEach(([label, commandId]) => {
      root.appendChild(textItem({
        label,
        accel: acceleratorFor(commandId),
        onClick: () => executeCommand(commandId)
      }))
    })

    root.appendChild(separatorEl())

    // Structural row + hover-expanded "more" panel.
    const structural: Array<[string, string, string]> = [
      [t('menu.paragraph.quoteBlock'), 'paragraph.quote-block', 'quote'],
      [t('menu.paragraph.bulletList'), 'paragraph.bullet-list', 'bullet'],
      [t('menu.paragraph.orderedList'), 'paragraph.order-list', 'order'],
      [t('menu.paragraph.taskList'), 'paragraph.task-list', 'task'],
      [t('menu.paragraph.horizontalRule'), 'paragraph.horizontal-line', 'hr']
    ]
    const buttons = structural.map(([label, commandId, icon]) => iconButton({
      icon,
      hint: label,
      accel: acceleratorFor(commandId),
      onClick: () => executeCommand(commandId)
    }))

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
  }

  document.addEventListener('contextmenu', (ev) => {
    const target = ev.target as HTMLElement | null
    if (!target || !target.closest) return
    if (!target.closest('.editor-wrapper')) return
    // Source-code pane and form fields keep their native menus.
    if (target.closest('.CodeMirror')) return
    if (target.closest('input, textarea')) return
    ev.preventDefault()
    ev.stopPropagation()
    try {
      openOverlay({ x: ev.clientX, y: ev.clientY, build: buildPanel })
    } catch (err) {
      console.error('[contextMenu]', err)
    }
  }, true)
}

export default initEditorContextMenu
