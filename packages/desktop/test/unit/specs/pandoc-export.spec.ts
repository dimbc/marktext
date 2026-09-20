import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()

// `pandoc.ts` pulls in `command-exists`, which reaches `child_process` through a
// default import — so the mock has to expose `default` as well, or the module
// fails to evaluate and every test in this file is skipped.
vi.mock('child_process', () => {
  const spawn = (...args: unknown[]) => spawnMock(...args)
  return { default: { spawn }, spawn }
})

import pandoc, {
  PANDOC_EXPORT_FORMATS,
  getPandocLanguage,
  getPandocReader
} from 'main_renderer/utils/pandoc'

/** Stands in for the ChildProcess that `spawn` would hand back. */
class FakeProcess extends EventEmitter {
  // `stdin` is an emitter too: `toFile` has to survive the EPIPE the pipe
  // reports when pandoc exits before draining it.
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  stderr = new EventEmitter()
}

const startProcess = (): FakeProcess => {
  const proc = new FakeProcess()
  spawnMock.mockReturnValue(proc)
  return proc
}

const argsOfLastSpawn = (): string[] => {
  const { calls } = spawnMock.mock
  return calls[calls.length - 1]?.[1] as string[]
}

const optionsOfLastSpawn = (): unknown => {
  const { calls } = spawnMock.mock
  return calls[calls.length - 1]?.[2]
}

describe('pandoc export', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    delete process.env.MARKTEXT_PANDOC
  })

  afterEach(() => {
    delete process.env.MARKTEXT_PANDOC
  })

  describe('PANDOC_EXPORT_FORMATS', () => {
    it('covers the formats requested in #2103 and #3917', () => {
      const ids = PANDOC_EXPORT_FORMATS.map((f) => f.id)
      expect(ids).toContain('docx')
      expect(ids).toContain('odt')
      expect(ids).toContain('epub')
    })
  })

  describe('getPandocReader', () => {
    // pandoc's `markdown` reader turns on extensions that change what the text
    // says (`smart` quotes, citations, line blocks), so the export has to parse
    // with the dialect MarkText edits (#5379).
    it('reads GFM by default, because `~x~`/`^x^` are literal by default', () => {
      expect(getPandocReader(false)).toBe('gfm')
    })

    it('adds sub/superscript only when the preference asks for it', () => {
      expect(getPandocReader(true)).toBe('gfm+superscript+subscript')
    })

    // Pandoc 3.1.3 (Ubuntu 24.04) exits with "The extension tex_math_gfm is not
    // supported for gfm"; anything newer must not be named here.
    it('names no extension beyond the ones pandoc 3.1.3 accepts', () => {
      expect(getPandocReader(true)).not.toMatch(/tex_math_gfm|alerts/)
    })

    // `gfm` enables footnotes on its own, while the editor renders them only
    // when its own preference says so. Without `-footnotes`, a `[^1]` the editor
    // shows as literal text turns into a real footnote in the exported file.
    it('keeps footnotes literal when the editor does not render them', () => {
      expect(getPandocReader(false, false)).toBe('gfm-footnotes')
    })
  })

  describe('getPandocLanguage', () => {
    // pandoc carries Chinese under a script subtag only — it ships `zh-Hans`
    // and `zh-Hant` and no `zh-CN`, and an unresolvable tag makes every export
    // complain about pandoc's own translation files (#5379).
    it('spells the Chinese region as the script subtag pandoc carries', () => {
      expect(getPandocLanguage('zh-CN')).toBe('zh-Hans')
      expect(getPandocLanguage('zh_SG')).toBe('zh-Hans')
      expect(getPandocLanguage('zh-TW')).toBe('zh-Hant')
      expect(getPandocLanguage('zh-Hant')).toBe('zh-Hant')
    })

    it('passes every other locale through unchanged', () => {
      expect(getPandocLanguage('en-US')).toBe('en-US')
      expect(getPandocLanguage('ja')).toBe('ja')
    })
  })

  describe('locating the binary', () => {
    // `MARKTEXT_PANDOC` is the documented way to point at a pandoc the PATH
    // lookup cannot find: a portable copy, another drive. `process.execPath`
    // stands in for it here because it is a file that certainly exists.
    it('spawns the binary MARKTEXT_PANDOC names', async() => {
      process.env.MARKTEXT_PANDOC = process.execPath
      const proc = startProcess()

      const pending = pandoc.toFile('docx', '/tmp/x.docx', 'x')
      proc.emit('close', 0)
      await pending

      expect(spawnMock).toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.anything())
    })

    it('reports pandoc as available when MARKTEXT_PANDOC points at a file', () => {
      process.env.MARKTEXT_PANDOC = process.execPath
      expect(pandoc.exists()).toBe(true)
    })
  })

  describe('pandoc.toFile', () => {
    it('pipes the document over stdin and asks pandoc for a file target', async() => {
      const proc = startProcess()

      const pending = pandoc.toFile('docx', '/tmp/notes.docx', '# Title')
      proc.emit('close', 0)

      await expect(pending).resolves.toEqual({ warnings: '' })
      // `-o` is what makes binary writers (docx/odt/epub/pptx) possible at all:
      // the result is a zip container, which the streaming converter above
      // cannot carry because it decodes stdout into a string.
      expect(spawnMock).toHaveBeenCalledWith(
        'pandoc',
        ['-f', 'gfm', '-t', 'docx', '-s', '-o', '/tmp/notes.docx'],
        { cwd: undefined }
      )
      expect(proc.stdin.end).toHaveBeenCalledWith('# Title')
    })

    // Relative links are resolved by pandoc itself, against the cwd when the
    // document comes in over stdin. Without the source folder, `![](pics/a.png)`
    // is not found, pandoc substitutes the alt text and still exits 0, so
    // docx/odt/epub silently come out without their images (#5379).
    it('runs pandoc in the document folder so relative image links resolve', async() => {
      const proc = startProcess()

      const pending = pandoc.toFile('docx', '/tmp/notes.docx', 'x', { cwd: '/docs/notes' })
      proc.emit('close', 0)
      await pending

      expect(optionsOfLastSpawn()).toEqual({ cwd: '/docs/notes' })
    })

    it('parses with the reader it was given', async() => {
      const proc = startProcess()

      const pending = pandoc.toFile('docx', '/tmp/x.docx', 'x', { reader: getPandocReader(true) })
      proc.emit('close', 0)
      await pending

      expect(argsOfLastSpawn().slice(0, 2)).toEqual(['-f', 'gfm+superscript+subscript'])
    })

    // The html5 writer copies an image `src` verbatim, so an export written
    // anywhere but the source folder showed broken pictures where docx/odt/epub
    // would have carried the bytes (#5379).
    it('inlines the resources of an HTML export', async() => {
      const proc = startProcess()

      const pending = pandoc.toFile('html5', '/tmp/notes.html', 'x')
      proc.emit('close', 0)
      await pending

      expect(argsOfLastSpawn()).toEqual([
        '-f',
        'gfm',
        '-t',
        'html5',
        '-s',
        '--embed-resources',
        '-o',
        '/tmp/notes.html'
      ])
    })

    // The document arrives on stdin, so pandoc has no source file to take a
    // title from; the caller passes what each writer wants.
    it('passes metadata on as --metadata key:value', async() => {
      const proc = startProcess()

      const pending = pandoc.toFile('epub3', '/tmp/x.epub', 'x', {
        metadata: { title: 'Notes: draft', lang: 'zh-Hans' }
      })
      proc.emit('close', 0)
      await pending

      const args = argsOfLastSpawn()
      expect(args).toContain('--metadata=title:Notes: draft')
      expect(args).toContain('--metadata=lang:zh-Hans')
      expect(args.slice(-2)).toEqual(['-o', '/tmp/x.epub'])
    })

    // An empty value is exactly what pandoc complains about, so it is dropped
    // rather than passed on.
    it('drops an empty metadata value', async() => {
      const proc = startProcess()

      const pending = pandoc.toFile('docx', '/tmp/x.docx', 'x', { metadata: { title: '' } })
      proc.emit('close', 0)
      await pending

      expect(argsOfLastSpawn().some((arg) => arg.startsWith('--metadata'))).toBe(false)
    })

    it('reports the warnings pandoc prints on a successful conversion', async() => {
      const proc = startProcess()

      const pending = pandoc.toFile('docx', '/tmp/x.docx', 'x')
      proc.stderr.emit(
        'data',
        Buffer.from(
          '[WARNING] Could not fetch resource pics/a.png: replacing image with description\n'
        )
      )
      proc.emit('close', 0)

      await expect(pending).resolves.toEqual({
        warnings: '[WARNING] Could not fetch resource pics/a.png: replacing image with description'
      })
    })

    // A writer pandoc rejects fails before it has read stdin; Node then emits
    // EPIPE on the pipe, which without a listener becomes an uncaught exception
    // in the main process ("Unexpected error" dialog). The failure itself still
    // arrives through `close`.
    it('survives an EPIPE on stdin', async() => {
      const proc = startProcess()

      const pending = pandoc.toFile('docx', '/tmp/x.docx', 'x'.repeat(70 * 1024))
      expect(() => proc.stdin.emit('error', new Error('write EPIPE'))).not.toThrow()
      proc.stderr.emit('data', Buffer.from('pandoc: Unknown output format broke\n'))
      proc.emit('close', 1)

      await expect(pending).rejects.toThrow('Unknown output format broke')
    })

    it('rejects with the pandoc error text instead of the exit code', async() => {
      const proc = startProcess()

      const pending = expect(pandoc.toFile('docx', '/tmp/x.docx', 'x')).rejects.toThrow(
        'Unknown output format docx'
      )
      proc.stderr.emit('data', Buffer.from('pandoc: Unknown output format docx\n'))
      proc.emit('close', 1)
      await pending
    })

    it('falls back to the exit code when pandoc says nothing', async() => {
      const proc = startProcess()

      const pending = expect(pandoc.toFile('docx', '/tmp/x.docx', 'x')).rejects.toThrow(
        'pandoc exited with code 3'
      )
      proc.emit('close', 3)
      await pending
    })

    it('rejects when the pandoc binary cannot be spawned', async() => {
      const proc = startProcess()
      const failure = new Error('spawn pandoc ENOENT')

      const pending = expect(pandoc.toFile('docx', '/tmp/x.docx', 'x')).rejects.toThrow(
        'spawn pandoc ENOENT'
      )
      proc.emit('error', failure)
      await pending
    })
  })
})
