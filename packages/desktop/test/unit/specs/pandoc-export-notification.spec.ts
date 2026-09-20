import { beforeEach, describe, expect, it, vi } from 'vitest'

// `menu/actions/file.ts` registers itself on `ipcMain` at module load, so the
// Electron, log, i18n and pandoc surfaces are stubbed and the registered
// handler is driven directly. Only the save dialog and the conversion itself
// are unreachable from a unit test; neither decides what the user is told.
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
// Electron's ABI rather than the Node running the tests (see
// watcher-await-write-finish.spec.ts). Nothing here guesses an encoding.
vi.mock('ced', () => ({ default: () => 'UTF-8' }))

// Return the key instead of the text loaded off disk: the assertions are about
// which message the handler asks for, and key parity across locales is enforced
// separately by locale-validation.spec.ts.
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
  // The module registered this once, at import — the map must not be cleared
  // between tests or the handler goes with it.
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

  // A stderr holding only a line break is truthy but summarizes to nothing; an
  // empty toast over a successful export would be worse than no toast.
  it('stays quiet when stderr holds nothing but whitespace', async() => {
    toFile.mockResolvedValue({ warnings: '\r\n\n' })

    await exportWith()

    expect(sent.map((s) => s.channel)).toEqual(['mt::export-success'])
  })

  // pandoc warns per unresolved link and still exits 0, so a document with a
  // dozen bad image paths would otherwise push a dozen-line toast over the
  // editor — the notification has no height cap.
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

  // `services/notification` assigns the body to `innerHTML`, so markup in it
  // renders. DOMPurify sanitizes on the way in but keeps character references
  // as-is, which means escaping has to happen here in main — and the paths
  // pandoc quotes back come straight from the document.
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

  // pandoc reports the translation files it could not load for a locale it does
  // not ship. Those lines say nothing about the document, and the language
  // mapping in the main process keeps the common case from reaching them at all
  // (#5379).
  it('drops pandoc complaints about its own translation data files', async() => {
    toFile.mockResolvedValue({
      warnings: [
        '[WARNING] Could not load translations for sw translations/sw.yaml:',
        'translations/sw.yaml: openBinaryFile: does not exist (No such file or directory)',
        ...warningLines(1)
      ].join('\n')
    })

    await exportWith()

    expect(notification().message).toBe(warningLines(1).join('<br>'))
  })

  // The success notice offers to open the file manager, and clicking it
  // dismisses whatever is on top: the warning has to be readable first (#5379).
  it('warns about a dropped image before announcing success', async() => {
    toFile.mockResolvedValue({ warnings: warningLines(1).join('\n') })

    await exportWith()

    expect(sent.map((s) => s.channel)).toEqual(['mt::show-notification', 'mt::export-success'])
  })

  // Which title a writer wants differs: html5 fills <title> from `pagetitle` and
  // renders a full `title` as a second heading on top of the document's own, the
  // EPUB title page is conventional, and the rest need neither (#5379).
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

  // The language reaches the file as `lang` metadata, and the spawn
  // environment's own locale is the string "C" rather than what the user reads.
  it('passes the app language, not the locale of the spawn environment', async() => {
    await exportWith()

    expect(metadataOfLastExport().lang).toBe('en')
  })

  // A failure reported under the warning title reads as a caveat on a file that
  // was written; it is not one (#5379).
  it('titles a failed export as a failure', async() => {
    toFile.mockRejectedValue(new Error('pandoc: Unknown output format docx'))

    await exportWith()

    expect(notification().title).toBe('dialog.exportFailure')
  })

  // A stderr that held nothing but pandoc's translation lines summarizes to
  // nothing, and an empty error toast would tell the user nothing at all.
  it('never leaves the failure body empty', async() => {
    toFile.mockRejectedValue(
      new Error('[WARNING] Could not load translations for sw translations/sw.yaml:')
    )

    await exportWith()

    const { type, message } = notification()
    expect(type).toBe('error')
    expect(message.length).toBeGreaterThan(0)
  })
})
