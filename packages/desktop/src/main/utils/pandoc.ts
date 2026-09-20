// Copy from https://github.com/utatti/simple-pandoc/blob/master/index.js
import { spawn } from 'child_process'
import path from 'path'
import type { Readable } from 'stream'
import commandExists from 'command-exists'
import { isFile2 } from 'common/filesystem'

const pandocCommand = 'pandoc'

/**
 * Targets offered by "Export → Convert with Pandoc".
 *
 * `target` is the pandoc writer name (not always the format id — epub maps to
 * `epub3`), `extension` drives the save dialog filter, and `label` is shown
 * verbatim in the menu. The labels stay in English on purpose: they are format
 * names rather than prose, and translating them would add ten keys to keep in
 * sync across every locale file for no reader benefit.
 */
export interface PandocExportFormat {
  id: string
  label: string
  target: string
  extension: string
}

export const PANDOC_EXPORT_FORMATS: readonly PandocExportFormat[] = Object.freeze([
  { id: 'docx', label: 'Word (.docx)', target: 'docx', extension: '.docx' },
  { id: 'odt', label: 'OpenDocument (.odt)', target: 'odt', extension: '.odt' },
  { id: 'rtf', label: 'RTF (.rtf)', target: 'rtf', extension: '.rtf' },
  { id: 'epub', label: 'EPUB (.epub)', target: 'epub3', extension: '.epub' },
  { id: 'latex', label: 'LaTeX (.tex)', target: 'latex', extension: '.tex' },
  { id: 'rst', label: 'reStructuredText (.rst)', target: 'rst', extension: '.rst' },
  { id: 'org', label: 'Org mode (.org)', target: 'org', extension: '.org' },
  { id: 'mediawiki', label: 'MediaWiki (.wiki)', target: 'mediawiki', extension: '.wiki' },
  { id: 'textile', label: 'Textile (.textile)', target: 'textile', extension: '.textile' },
  { id: 'opml', label: 'OPML (.opml)', target: 'opml', extension: '.opml' }
])

/**
 * Reader to hand the document to pandoc with.
 *
 * `gfm` reproduces what the editor shows, while pandoc's own `markdown` reader
 * turns on extensions that change what the text says (`smart` curls quotes,
 * `@alice` becomes a citation, `# Title {#x}` loses the attribute). Nothing
 * newer is added on purpose: pandoc 3.1.3 (Ubuntu 24.04) exits with "The
 * extension tex_math_gfm is not supported for gfm".
 *
 * `superSubScript` is off by default, so `~x~`/`^x^` must stay literal unless
 * the user asked for sub/superscript. `gfm` enables footnotes on its own, which
 * the editor only renders when its own `footnote` preference says so — hence
 * `-footnotes`, so a `[^1]` shown as literal text stays literal in the file.
 */
export const getPandocReader = (superSubScript: boolean, footnotes = true): string => {
  let reader = 'gfm'
  if (superSubScript) {
    reader += '+superscript+subscript'
  }
  if (!footnotes) {
    reader += '-footnotes'
  }
  return reader
}

/**
 * The language tag to hand pandoc as `lang` metadata.
 *
 * pandoc carries Chinese under the script subtag only — it ships `zh-Hans` and
 * `zh-Hant`, and no `zh`, `zh-CN` or `zh-TW`. A tag it cannot resolve makes the
 * export print two lines about its own translations on every run; spelling the
 * region subtag as the script subtag says the same thing and keeps the export
 * quiet. Every other locale passes through untouched.
 */
const HANT_REGIONS = new Set(['hant', 'tw', 'hk', 'mo'])

export const getPandocLanguage = (locale: string): string => {
  const [language, region = ''] = locale.trim().split(/[-_]/)
  if (language?.toLowerCase() !== 'zh') {
    return locale
  }
  return HANT_REGIONS.has(region.toLowerCase()) ? 'zh-Hant' : 'zh-Hans'
}

/**
 * Where the Windows installer puts pandoc when it was told not to touch `PATH`.
 * Together with `MARKTEXT_PANDOC` and a plain `PATH` lookup this covers the
 * three ways a user can have pandoc on a Windows machine. Windows only: on
 * macOS and Linux `patchEnvPath` already adds the Homebrew and `/usr/local/bin`
 * directories a GUI-launched app does not inherit (#2751).
 */
const pandocLocations = (): string[] => {
  if (process.platform !== 'win32') {
    return []
  }
  const { env } = process
  return [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA,
    env.ProgramData && path.join(env.ProgramData, 'chocolatey', 'bin'),
    env.USERPROFILE && path.join(env.USERPROFILE, 'scoop', 'shims'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')
  ]
    .filter((dir): dir is string => !!dir)
    .map((dir) => path.join(dir, 'pandoc.exe'))
}

/**
 * Windows only: since the CVE-2024-27980 fix Node refuses to spawn a `.bat`/
 * `.cmd` without `shell: true` (EINVAL), and a shell would mean quoting
 * user-supplied paths by hand. Such a shim is therefore treated as absent so
 * the next source gets a chance.
 */
const isBatchFile = (command: string): boolean =>
  process.platform === 'win32' && /\.(bat|cmd)$/i.test(command.trim())

const getCommand = (): string => {
  if (envPathExists()) {
    return process.env.MARKTEXT_PANDOC as string
  }
  return pandocLocations().find((candidate) => isFile2(candidate)) ?? pandocCommand
}

interface PandocConverter {
  (): Promise<string>
  stream: (srcStream: NodeJS.ReadableStream) => Readable | null
}

interface PandocFn {
  (from: string, to: string, ...args: string[]): PandocConverter
  exists: () => boolean
  toFile: (
    to: string,
    outputPath: string,
    input: string,
    options?: PandocToFileOptions
  ) => Promise<PandocToFileResult>
}

const pandoc = ((from: string, to: string, ...args: string[]): PandocConverter => {
  const command = getCommand()
  const option = ['-s', from, '-t', to].concat(args)

  const converter = ((): Promise<string> =>
    new Promise((resolve, reject) => {
      const proc = spawn(command, option)
      proc.on('error', reject)
      let data = ''
      proc.stdout.on('data', (chunk: Buffer | string) => {
        data += chunk.toString()
      })
      proc.stdout.on('end', () => resolve(data))
      proc.stdout.on('error', reject)
      proc.stdin.end()
    })) as PandocConverter

  converter.stream = (srcStream: NodeJS.ReadableStream): Readable | null => {
    const proc = spawn(command, option)
    srcStream.pipe(proc.stdin)
    return proc.stdout
  }

  return converter
}) as PandocFn

pandoc.exists = (): boolean => {
  const command = getCommand()
  return command !== pandocCommand || commandExists.sync(pandocCommand)
}

export interface PandocToFileOptions {
  /**
   * Directory the document's relative links resolve against. Pass the folder
   * holding the source document: pandoc resolves `![](pics/a.png)` against the
   * process cwd otherwise, which is `/` in a packaged app, and a file it cannot
   * find is quietly replaced with the image's alt text while pandoc still exits
   * 0 — so docx/odt/epub come out with the pictures missing and no error.
   */
  cwd?: string
  /** Reader used to parse `input`; see `getPandocReader`. */
  reader?: string
  /**
   * `--metadata key:value` pairs for the writer.
   *
   * The document arrives on stdin, so pandoc has no source file to take a title
   * from: a standalone EPUB then comes out with no `<dc:title>` and prints a
   * warning on every conversion. Which title a writer wants differs — see the
   * caller. Empty values are dropped rather than passed on, because setting a
   * field to the empty string is exactly what pandoc complains about.
   */
  metadata?: Record<string, string>
}

export interface PandocToFileResult {
  /**
   * Pandoc's stderr from a successful run: empty when it stayed quiet, and
   * otherwise the `[WARNING]` lines (an image it could not fetch, an unknown
   * extension) that exit code 0 would hide from the user.
   */
  warnings: string
}

/**
 * Convert `input` from markdown and write the result to `outputPath`.
 *
 * The streaming API above cannot serve binary targets because it decodes stdout
 * into a string, and docx/odt/epub/pptx are zip containers. The document
 * therefore goes in over stdin and the result is written by pandoc itself.
 */
pandoc.toFile = (
  to: string,
  outputPath: string,
  input: string,
  options: PandocToFileOptions = {}
): Promise<PandocToFileResult> =>
  new Promise((resolve, reject) => {
    const { cwd, reader = getPandocReader(false), metadata = {} } = options
    const option = ['-f', reader, '-t', to, '-s']

    // The html5 writer copies an image `src` verbatim, so an export written
    // anywhere but the source folder shows broken pictures where docx/odt/epub
    // would have carried the bytes. Embedding inlines them; a source pandoc
    // cannot fetch still degrades to a warning.
    if (to === 'html5') {
      option.push('--embed-resources')
    }
    // pandoc splits on the first colon only, so a title such as "Q3: plan" is
    // passed through unchanged.
    for (const [key, value] of Object.entries(metadata)) {
      if (value) {
        option.push(`--metadata=${key}:${value}`)
      }
    }
    option.push('-o', outputPath)

    const proc = spawn(getCommand(), option, { cwd })
    let errorOutput = ''
    proc.on('error', reject)
    proc.stderr.on('data', (chunk: Buffer | string) => {
      errorOutput += chunk.toString()
    })
    // Pandoc can exit before it has drained stdin — an unknown writer fails
    // immediately — and the pipe then emits EPIPE on a document larger than the
    // pipe buffer. Unhandled, that becomes an uncaught exception in the main
    // process; the exit code and stderr still arrive through `close`.
    proc.stdin.on('error', () => {})
    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ warnings: errorOutput.trim() })
      } else {
        // pandoc reports conversion errors on stderr with exit code 1; surface
        // that text because it names the offending source position.
        reject(new Error(errorOutput.trim() || `pandoc exited with code ${String(code)}`))
      }
    })
    proc.stdin.end(input)
  })

const envPathExists = (): boolean => {
  const fromEnv = process.env.MARKTEXT_PANDOC
  return !!fromEnv && isFile2(fromEnv) && !isBatchFile(fromEnv)
}

export default pandoc
