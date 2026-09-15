/**
 * Shared overlay engine for MarkText's custom HTML menus.
 *
 * Electron MenuItems cannot lay their entries out horizontally (an icon always
 * occupies a full row), so any compact menu has to be drawn as DOM. This module
 * owns the parts that would otherwise be duplicated: a single overlay instance,
 * viewport clamping, dismissal handling, theming through the theme's `:root`
 * CSS variables and the small element factories the menus are assembled from.
 *
 * Menus describe content only — they never touch lifecycle or styling here.
 */
import bus from '../bus'
import { isOsx } from '@/util'

export const STYLE_ID = 'mt-ctx-menu-style'

const CSS = [
  '.mt-ctx{position:fixed;z-index:100000;min-width:196px;max-width:280px;',
  'background:var(--floatBgColor,#3f3f3f);color:var(--editorColor,#ddd);',
  'border:1px solid var(--floatBorderColor,rgba(0,0,0,.12));',
  'border-radius:6px;box-shadow:0 3px 12px var(--floatShadow,rgba(0,0,0,.25));',
  'padding:4px;font-size:13px;user-select:none;',
  'font-family:"Open Sans","Clear Sans","Helvetica Neue",Helvetica,Arial,sans-serif;',
  'box-sizing:border-box;}',
  '.mt-ctx *{box-sizing:border-box;}',
  '.mt-ctx-row{display:flex;align-items:center;gap:2px;padding:2px 0;}',
  '.mt-ctx-btn{position:relative;flex:1 1 0;min-width:0;height:28px;display:flex;',
  'align-items:center;justify-content:center;border:none;background:transparent;',
  'color:var(--editorColor80,var(--editorColor,#ccc));border-radius:4px;cursor:pointer;',
  'font-size:13px;padding:0;transition:background .12s,color .12s;}',
  '.mt-ctx-btn:hover:not(:disabled){background:var(--floatHoverColor,rgba(128,128,128,.18));',
  'color:var(--themeColor,#409eff);}',
  '.mt-ctx-btn:disabled{opacity:.35;cursor:default;}',
  '.mt-ctx-btn .mt-ctx-ic{display:flex;align-items:center;justify-content:center;',
  'width:16px;height:16px;line-height:1;}',
  '.mt-ctx-btn .mt-ctx-ic svg{width:16px;height:16px;fill:none;stroke:currentColor;',
  'stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;}',
  '.mt-ctx-btn .mt-ctx-tx{font-size:13px;font-weight:600;line-height:1;',
  'font-family:"DejaVu Sans Mono","Source Code Pro",monospace;}',
  // Hint-on-hover via pure CSS; `title` would be uncontrollable native styling.
  '.mt-ctx-btn:hover:not(:disabled)::after{content:attr(data-hint);position:absolute;',
  'bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);white-space:nowrap;',
  'background:var(--floatBgColor,#3f3f3f);color:var(--editorColor,#eee);',
  'border:1px solid var(--floatBorderColor,rgba(0,0,0,.15));border-radius:4px;',
  'padding:3px 7px;font-size:11px;font-weight:400;line-height:1.3;',
  'box-shadow:0 2px 6px var(--floatShadow,rgba(0,0,0,.25));pointer-events:none;z-index:1;}',
  '.mt-ctx-item{position:relative;display:flex;align-items:center;height:28px;',
  'padding:0 8px 0 10px;border-radius:4px;cursor:pointer;gap:8px;}',
  '.mt-ctx-item:hover:not(.is-disabled){background:var(--floatHoverColor,rgba(128,128,128,.18));',
  'color:var(--themeColor,#409eff);}',
  '.mt-ctx-item.is-disabled{opacity:.35;cursor:default;}',
  '.mt-ctx-item .mt-ctx-label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap;color:inherit;}',
  '.mt-ctx-item .mt-ctx-acc{flex:0 0 auto;color:var(--editorColor50,#999);',
  'font-size:11px;font-family:"DejaVu Sans Mono","Source Code Pro",monospace;',
  'opacity:0;transition:opacity .12s;}',
  '.mt-ctx-item:hover:not(.is-disabled) .mt-ctx-acc{opacity:1;}',
  '.mt-ctx-sep{height:1px;margin:4px 6px;background:var(--floatBorderColor,rgba(128,128,128,.25));}',
  '.mt-ctx-head{padding:5px 10px 3px;font-size:11px;letter-spacing:.4px;',
  'color:var(--editorColor40,var(--editorColor50,#888));text-transform:uppercase;}',
  '.mt-ctx-sub{position:fixed;z-index:100001;min-width:180px;}'
].join('')

export const ICONS: Record<string, string> = {
  cut: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  selall: '<svg viewBox="0 0 24 24"><path d="M3 5V3h2M3 12v2M3 19v2h2M21 5V3h-2M21 12v2M21 19v2h-2M8 3h2M14 3h2M8 21h2M14 21h2M3 8v2M3 14v2M21 8v2M21 14v2"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>',
  bold: '<svg viewBox="0 0 24 24"><path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/></svg>',
  italic: '<svg viewBox="0 0 24 24"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
  strike: '<svg viewBox="0 0 24 24"><path d="M16 4H9a3 3 0 0 0-2 5.2M8 20h7a3 3 0 0 0 2-5.2"/><line x1="4" y1="12" x2="20" y2="12"/></svg>',
  code: '<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  quote: '<svg viewBox="0 0 24 24"><path d="M4 5h16M4 10h10M4 15h16M4 20h10"/></svg>',
  bullet: '<svg viewBox="0 0 24 24"><circle cx="5" cy="7" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="5" cy="17" r="1.3"/><path d="M10 7h10M10 12h10M10 17h10"/></svg>',
  order: '<svg viewBox="0 0 24 24"><path d="M10 7h10M10 12h10M10 17h10"/><path d="M4 6h1v4M4 14.5h2v1l-2 2h2"/></svg>',
  task: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="6" height="6" rx="1"/><path d="M5 8l1.5 1.5L9 7"/><path d="M13 8h8M13 16h8"/><rect x="3" y="13" width="6" height="6" rx="1"/></svg>',
  hr: '<svg viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
  newTab: '<svg viewBox="0 0 24 24"><path d="M14 3v5h5"/><path d="M19 12V5l-8 8"/><path d="M5 5v14h14v-7"/></svg>',
  openFile: '<svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>',
  openFolder: '<svg viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  saveAs: '<svg viewBox="0 0 24 24"><path d="M14 3v5h5"/><path d="M19 12V5l-8 8"/><path d="M5 21h6M11 21H5a2 2 0 0 1-2-2v-6"/></svg>',
  exportFile: '<svg viewBox="0 0 24 24"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
  importFile: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
  print: '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 17h12v4H6z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg>'
}

/** Accelerators shown before the main process keybinding map arrives, and for
 *  entries the user has left unbound. */
const FALLBACK_ACCELERATORS: Record<string, string> = {
  'paragraph.code-fence': 'Ctrl+Shift+K',
  'paragraph.table': 'Ctrl+Shift+T',
  'format.image': 'Ctrl+Shift+I',
  'paragraph.quote-block': 'Ctrl+Shift+Q',
  'paragraph.bullet-list': 'Ctrl+H',
  'paragraph.order-list': 'Ctrl+G',
  'paragraph.task-list': 'Ctrl+Shift+X',
  'paragraph.horizontal-line': 'Ctrl+_',
  'paragraph.heading-1': 'Ctrl+Alt+1',
  'paragraph.heading-2': 'Ctrl+Alt+2',
  'format.strong': 'Ctrl+B',
  'format.emphasis': 'Ctrl+I',
  'format.strike': 'Alt+Shift+5',
  'format.inline-code': 'Ctrl+Y',
  'format.hyperlink': 'Ctrl+L',
  'format.inline-math': 'Ctrl+Shift+M',
  'edit.find': 'Ctrl+F'
}

/** Electron accelerator → short human label ("Cmd" on macOS, "Ctrl" elsewhere). */
export const formatAccelerator = (raw: string | undefined): string => {
  if (!raw) return ''
  const modifier = isOsx ? 'Cmd' : 'Ctrl'
  return String(raw)
    .replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/gi, modifier)
    .replace(/Option/gi, 'Alt')
}

/** Clamp a floating panel of `w`×`h` into the viewport, flipping to the
 *  mouse's left/top side when it would overflow right/bottom. Pure function —
 *  jsdom has no layout, so boundary behaviour is only testable this way. */
export const clampPosition = (
  px: number,
  py: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 6
): { x: number; y: number } => {
  let outX = px
  let outY = py
  if (w > vw - margin * 2) {
    outX = margin
  } else if (px + w > vw - margin) {
    outX = Math.max(margin, px - w)
    if (outX < margin) outX = vw - w - margin
  }
  if (h > vh - margin * 2) {
    outY = margin
  } else if (py + h > vh - margin) {
    outY = Math.max(margin, py - h)
    if (outY < margin) outY = vh - h - margin
  }
  return { x: Math.max(margin, outX), y: Math.max(margin, outY) }
}

/** Execute through the command center. It throws for unknown ids — swallow
 *  here so one stale id can never break the rest of the menu. */
export const executeCommand = (commandId: string): void => {
  try {
    bus.emit('cmd::execute', commandId)
  } catch (err) {
    console.error('[contextMenu]', err)
  }
}

export const ensureStyle = (): void => {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

// The main process owns the real keybinding map (user-customisable); the
// fallback table above only covers defaults. Requested once per window.
const keybindingMap: Record<string, string> = {}
let keybindingsRequested = false

export const requestKeybindings = (): void => {
  if (keybindingsRequested || !window.electron) return
  keybindingsRequested = true
  window.electron.ipcRenderer.on('mt::keybindings-response', (_e, map) => {
    if (map && typeof map === 'object') {
      Object.assign(keybindingMap, map)
    }
  })
  window.electron.ipcRenderer.send('mt::request-keybindings')
}

export const acceleratorFor = (commandId: string): string => {
  requestKeybindings()
  return formatAccelerator(keybindingMap[commandId] || FALLBACK_ACCELERATORS[commandId])
}

/** Attributes that make an element a menu trigger. Listeners are below.
 *  `[data-mt-ctx-trigger]` pans outside-click dismissal so a trigger can toggle
 *  the overlay (see `openOverlay`). */
export const TRIGGER_SELECTOR = '[data-mt-ctx-trigger]'

export const rowEl = (children: HTMLElement[]): HTMLElement => {
  const row = document.createElement('div')
  row.className = 'mt-ctx-row'
  children.forEach((child) => row.appendChild(child))
  return row
}

export const separatorEl = (): HTMLElement => {
  const sep = document.createElement('div')
  sep.className = 'mt-ctx-sep'
  return sep
}

export const headingEl = (label: string): HTMLElement => {
  const head = document.createElement('div')
  head.className = 'mt-ctx-head'
  head.textContent = label
  return head
}

export interface IconButtonOptions {
  icon: string
  hint: string
  accel?: string
  onClick: () => void
  disabled?: boolean
}

export const iconButton = (options: IconButtonOptions): HTMLButtonElement => {
  const { icon, hint, accel = '', onClick, disabled = false } = options
  const btn = document.createElement('button')
  btn.className = 'mt-ctx-btn'
  btn.type = 'button'
  btn.dataset.hint = hint + (accel ? '  ' + accel : '')
  btn.innerHTML = '<span class="mt-ctx-ic">' + (ICONS[icon] ?? '') + '</span>'
  if (disabled) btn.disabled = true
  // Keep the editor's selection alive: a focused button would collapse it.
  btn.addEventListener('mousedown', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
  })
  btn.addEventListener('click', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    if (btn.disabled) return
    closeOverlay()
    onClick()
  })
  return btn
}

export interface TextItemOptions {
  label: string
  accel?: string
  /** Optional: entries that only expand a sub panel have no action of their
   *  own and simply swallow the click. */
  onClick?: () => void
  disabled?: boolean
  /** Appends a trailing chevron used by `attachSubmenu`. */
  trailing?: 'chevron'
}

export const textItem = (options: TextItemOptions): HTMLElement => {
  const { label, accel = '', onClick, disabled = false, trailing } = options
  const item = document.createElement('div')
  item.className = 'mt-ctx-item' + (disabled ? ' is-disabled' : '')
  const labelEl = document.createElement('span')
  labelEl.className = 'mt-ctx-label'
  labelEl.textContent = label
  item.appendChild(labelEl)
  if (accel) {
    const acc = document.createElement('span')
    acc.className = 'mt-ctx-acc'
    acc.textContent = accel
    item.appendChild(acc)
  }
  if (trailing === 'chevron') {
    const chevron = document.createElement('span')
    chevron.className = 'mt-ctx-ic'
    chevron.innerHTML = ICONS.chevron
    item.appendChild(chevron)
  }
  item.addEventListener('mousedown', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
  })
  item.addEventListener('click', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    if (disabled || !onClick) return
    closeOverlay()
    onClick()
  })
  return item
}

let panel: HTMLElement | null = null
let subPanel: HTMLElement | null = null
let offClick: ((ev: MouseEvent) => void) | null = null
let offKey: ((ev: KeyboardEvent) => void) | null = null
let closeHook: (() => void) | null = null
let boundGlobal = false

export const closeSubPanel = (): void => {
  if (subPanel) {
    subPanel.remove()
    subPanel = null
  }
}

export const closeOverlay = (): void => {
  closeSubPanel()
  if (panel) {
    panel.remove()
    panel = null
  }
  if (offClick) {
    document.removeEventListener('mousedown', offClick, true)
    offClick = null
  }
  if (offKey) {
    document.removeEventListener('keydown', offKey, true)
    offKey = null
  }
  // `openOverlay` clears the hook before rebuilding, and every dismissal —
  // including a click on a trigger element — has to reach the menu so it can
  // drop its "currently open" bookkeeping.
  const hook = closeHook
  closeHook = null
  if (hook) hook()
}

export const isOverlayOpen = (): boolean => panel !== null

export interface OpenOverlayOptions {
  x: number
  y: number
  build: (root: HTMLElement) => void
  /** Called once per dismissal so owners can reset toggle state. */
  onClose?: () => void
}

export const openOverlay = (options: OpenOverlayOptions): void => {
  const { x, y, build, onClose } = options
  ensureStyle()
  // Opening closes first, so `onClose` must be installed after that call.
  closeOverlay()
  closeHook = onClose ?? null

  const root = document.createElement('div')
  root.className = 'mt-ctx'
  // Measure off-screen: jsdom (and the first paint) would otherwise report 0.
  root.style.visibility = 'hidden'
  build(root)
  document.body.appendChild(root)
  const rect = root.getBoundingClientRect()
  const pos = clampPosition(
    x,
    y,
    rect.width || 210,
    rect.height || 250,
    window.innerWidth,
    window.innerHeight,
    6
  )
  root.style.left = pos.x + 'px'
  root.style.top = pos.y + 'px'
  root.style.visibility = ''
  panel = root

  // Timestamp instead of an async flag: the very same tick that opens the
  // panel sets it, so the opening click can never slip through.
  const openedAt = Date.now()
  offClick = (ev: MouseEvent) => {
    if (Date.now() - openedAt < 30) return
    const target = ev.target as HTMLElement | null
    // Trigger elements toggle the panel themselves in their click handler.
    if (target && target.closest && target.closest(TRIGGER_SELECTOR)) return
    if (panel && panel.contains(target as Node)) return
    if (subPanel && subPanel.contains(target as Node)) return
    closeOverlay()
  }
  offKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeOverlay()
  }
  document.addEventListener('mousedown', offClick, true)
  document.addEventListener('keydown', offKey, true)

  if (!boundGlobal) {
    boundGlobal = true
    // A stale overlay position is worse than no overlay.
    window.addEventListener('blur', closeOverlay)
    window.addEventListener('resize', closeOverlay)
  }
}

export interface SubPanelHover {
  onHoverIn: () => void
  onHoverOut: () => void
}

export const openSubPanel = (
  anchor: HTMLElement,
  build: (sub: HTMLElement) => void,
  hover?: SubPanelHover
): void => {
  closeSubPanel()
  const sub = document.createElement('div')
  sub.className = 'mt-ctx mt-ctx-sub'
  build(sub)
  sub.style.visibility = 'hidden'
  document.body.appendChild(sub)
  const rect = anchor.getBoundingClientRect()
  const subRect = sub.getBoundingClientRect()
  const sw = subRect.width || 190
  const sh = subRect.height || 300
  // Park next to the anchor, flipping to its left side when the viewport is
  // too narrow.
  let sx = rect.right + 4
  if (sx + sw > window.innerWidth - 6) sx = rect.left - sw - 4
  const pos = clampPosition(sx, rect.top, sw, sh, window.innerWidth, window.innerHeight, 6)
  sub.style.left = pos.x + 'px'
  sub.style.top = pos.y + 'px'
  sub.style.visibility = ''
  if (hover) {
    // Without these the panel would vanish the moment the cursor crosses the
    // gap between trigger and panel.
    sub.addEventListener('mouseenter', hover.onHoverIn)
    sub.addEventListener('mouseleave', hover.onHoverOut)
  }
  subPanel = sub
}

const SUBMENU_HIDE_DELAY = 220

/** Hover-expandable branch: pointer enters the trigger → panel appears; leaving
 *  either surface schedules a short dismissal so diagonal moves survive. */
export const attachSubmenu = (
  trigger: HTMLElement,
  build: (sub: HTMLElement) => void
): void => {
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  const cancelHide = (): void => {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }
  const scheduleHide = (): void => {
    cancelHide()
    hideTimer = setTimeout(() => {
      hideTimer = null
      closeSubPanel()
    }, SUBMENU_HIDE_DELAY)
  }
  trigger.addEventListener('mouseenter', () => {
    cancelHide()
    openSubPanel(trigger, build, { onHoverIn: cancelHide, onHoverOut: scheduleHide })
  })
  trigger.addEventListener('mouseleave', scheduleHide)
}
