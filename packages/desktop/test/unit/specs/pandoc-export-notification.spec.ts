import { beforeEach, describe, expect, it, vi } from 'vitest'

// `menu/actions/file.ts` registers itself on `ipcMain` at module load, so the
// electron/log/i18n/pandoc surfaces are stubbed and the handler is driven directly.
const { handlers, showSaveDialog, fromWebContents, toFile, sent } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(),
  fromWebContents: vi.fn(),
  toFile: vi.fn(),
  sent: [] as Array<{ channel: string, payload: Record<string, unknown> }>
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener)
    },
    handle: () => {},
    emit: () => {}
  },
  dialog: { showSaveDialog },
  BrowserWindow: { fromWebContents, getAllWindows: () => [] },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0' }
}))

vi.mock('electron-log', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('electron-updater', () => ({ autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn() } }))
// `main/filesystem` reaches the native `ced` addon, whose bindings are built for
// Electron's ABI, not the Node running the tests.
vi.mock('ced', () => ({ default: () => 'UTF-8' }))

// Return the key instead of the text off disk: the assertions are about which
// message the handler asks for, not its wording.
vi.mock('main_renderer/i18n', () => ({
  t: (key: string, params?: { count?: number }) =>
    params?.count === undefined ? key : `${key}#${params.count}`,
  getCurrentLanguage: () => 'en'
}))

vi.mock('main_renderer/utils/pandoc', () => ({
  default: { toFile },
  PANDOC_EXPORT_FORMATS: [
    { id: 'docx', label: 'Word', target: 'docx', extension: '.docx' },
    { id: 'html5', label: 'HTML', target: 'html5', extension: '.html' },
    { id: 'epub', label: 'EPUB', target: 'epub3', extension: '.epub' }
  ],
  getPandocReader: () => 'gfm',
  getPandocLanguage: (locale: string) => locale
}))

await import('main_renderer/menu/actions/file')

const FAKE_WIN = {
  id: 1,
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: Record<string, unknown>) => {
      sent.push({ channel, payload })
    }
  }
}
const fakeEvent = { sender: {} } as never

const EXPORT_PAYLOAD = {
  target: 'docx',
  markdown: '# Notes',
  title: 'Notes',
  pathname: '/docs/notes.md',
  superSubScript: false,
  footnote: false
}

const exportWith = async(target = 'docx'): Promise<void> => {
  const handler = handlers.get('mt::response-pandoc-export')
  if (!handler) throw new Error('mt::response-pandoc-export handler was not registered')
  await handler(fakeEvent, { ...EXPORT_PAYLOAD, target })
}

const notification = (): { title: string, type: string, message: string } => {
  const entry = sent.find((s) => s.channel === 'mt::show-notification')
  if (!entry) throw new Error('no notification was sent')
  return entry.payload as { title: string, type: string, message: string }
}

const metadataOfLastExport = (): Record<string, string> => {
  const { calls } = toFile.mock
  const options = calls[calls.length - 1]?.[3] as { metadata: Record<string, string> }
  return options.metadata
}

const warningLines = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `[WARNING] Could not fetch resource pics/${i}.png`)

describe('mt::response-pandoc-export notifications', () => {
  beforeEach(() => {
    sent.length = 0
    showSaveDialog.mockReset()
    fromWebContents.mockReset()
    toFile.mockReset()

    showSaveDialog.mockResolvedValue({ filePath: '/docs/notes.docx', canceled: false })
    fromWebContents.mockReturnValue(FAKE_WIN)
    toFile.mockResolvedValue({ warnings: '' })
  })

  it('stays quiet when pandoc exits cleanly', async() => {
    await exportWith()

    expect(sent.map((s) => s.channel)).toEqual(['mt::export-success'])
  })

  // A stderr holding only a line break is truthy but summarizes to nothing.
  it('stays quiet when stderr holds nothing but whitespace', async() => {
    toFile.mockResolvedValue({ warnings: '\r\n\n' })

    await exportWith()

    expect(sent.map((s) => s.channel)).toEqual(['mt::export-success'])
  })

  // pandoc warns per unresolved link and the notification has no height cap.
  it('lists the first warnings and counts the ones it dropped', async() => {
    toFile.mockResolvedValue({ warnings: warningLines(12).join('\n') })

    await exportWith()

    const { type, message } = notification()
    expect(type).toBe('warning')
    expect(message.split('<br>')).toEqual([
      ...warningLines(5),
      'dialog.exportWarningMore#7'
    ])
  })

  it('breaks short warning lists into readable lines', async() => {
    toFile.mockResolvedValue({ warnings: warningLines(2).join('\n') })

    await exportWith()

    expect(notification().message).toBe(warningLines(2).join('<br>'))
  })

  // `services/notification` assigns the body to `innerHTML` and DOMPurify keeps
  // character references as-is, so escaping has to happen in main.
  it('escapes HTML pandoc echoed from the document', async() => {
    toFile.mockResolvedValue({
      warnings: '[WARNING] Could not fetch resource pics/<b>a</b>.png: replacing image with description'
    })

    await exportWith()

    const { message } = notification()
    expect(message).toContain('&lt;b&gt;a&lt;/b&gt;')
    expect(message).not.toContain('<b>a</b>')
  })

  it('escapes the failure text as well', async() => {
    toFile.mockRejectedValue(new Error('pandoc: <script>alert(1)</script> is not a valid target'))

    await exportWith()

    const { type, message } = notification()
    expect(type).toBe('error')
    expect(message).toContain('&lt;script&gt;')
    expect(message).not.toContain('<script>')
  })

  // The success notice offers to dismiss what is on top with one click (#5379).
  it('warns about a dropped image before announcing success', async() => {
    toFile.mockResolvedValue({ warnings: warningLines(1).join('\n') })

    await exportWith()

    expect(sent.map((s) => s.channel)).toEqual(['mt::show-notification', 'mt::export-success'])
  })

  // html5 would render a full `title` as a second heading and EPUB needs it for
  // the title page; the rest take neither (#5379).
  it('gives each writer the title metadata it wants', async() => {
    await exportWith('html5')
    expect(metadataOfLastExport().pagetitle).toBe('Notes')
    expect(metadataOfLastExport()).not.toHaveProperty('title')

    toFile.mockClear()
    await exportWith('epub')
    expect(metadataOfLastExport().title).toBe('Notes')
    expect(metadataOfLastExport()).not.toHaveProperty('pagetitle')

    toFile.mockClear()
    await exportWith('docx')
    expect(metadataOfLastExport()).not.toHaveProperty('title')
    expect(metadataOfLastExport()).not.toHaveProperty('pagetitle')
  })

  // The spawn environment's locale reaches the file as the string "C".
  it('passes the app language, not the locale of the spawn environment', async() => {
    await exportWith()

    expect(metadataOfLastExport().lang).toBe('en')
  })

  // The warning title would read as a caveat on a file that was written (#5379).
  it('titles a failed export as a failure', async() => {
    toFile.mockRejectedValue(new Error('pandoc: Unknown output format docx'))

    await exportWith()

    expect(notification().title).toBe('dialog.exportFailure')
  })

  // A stderr holding only whitespace summarizes to nothing.
  it('never leaves the failure body empty', async() => {
    toFile.mockRejectedValue(new Error('\r\n  '))

    await exportWith()

    const { type, message } = notification()
    expect(type).toBe('error')
    expect(message.length).toBeGreaterThan(0)
  })
})
