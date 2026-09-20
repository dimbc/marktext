import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()

// `pandoc.ts` pulls in `command-exists`, which reaches `child_process` through a
// default import, so the mock has to expose `default` as well.
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
  // An emitter too, so `toFile` can be shown to survive the EPIPE on stdin.
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
    // The dialect MarkText edits, not pandoc's `markdown` reader (#5379).
    it('reads GFM by default, because `~x~`/`^x^` are literal by default', () => {
      expect(getPandocReader(false)).toBe('gfm')
    })

    it('adds sub/superscript only when the preference asks for it', () => {
      expect(getPandocReader(true)).toBe('gfm+superscript+subscript')
    })

    // pandoc 3.1.3 (Ubuntu 24.04) rejects `tex_math_gfm` for gfm.
    it('names no extension beyond the ones pandoc 3.1.3 accepts', () => {
      expect(getPandocReader(true)).not.toMatch(/tex_math_gfm|alerts/)
    })

    // `gfm` enables footnotes itself, which would make a literal `[^1]` real.
    it('keeps footnotes literal when the editor does not render them', () => {
      expect(getPandocReader(false, false)).toBe('gfm-footnotes')
    })
  })

  describe('getPandocLanguage', () => {
    // pandoc ships no `zh`, `zh-CN` or `zh-TW`, and an unresolvable `lang` makes
    // every export complain about pandoc's own translation files (#5379).
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
    // `process.execPath` stands in for the portable pandoc: a file that exists.
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
      expect(spawnMock).toHaveBeenCalledWith(
        'pandoc',
        ['-f', 'gfm', '-t', 'docx', '-s', '-o', '/tmp/notes.docx'],
        { cwd: undefined }
      )
      expect(proc.stdin.end).toHaveBeenCalledWith('# Title')
    })

    // Without it pandoc resolves `![](pics/a.png)` against the cwd and exits 0.
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

    // html5 copies an image `src` verbatim, unlike the binary writers (#5379).
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

    // An empty field is what pandoc complains about.
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

    // Without a listener this EPIPE is an uncaught exception in the main process.
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
