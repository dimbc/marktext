// Copy from https://github.com/utatti/simple-pandoc/blob/master/index.js
import { spawn } from 'child_process'
import path from 'path'
import type { Readable } from 'stream'
import commandExists from 'command-exists'
import { isFile2 } from 'common/filesystem'

const pandocCommand = 'pandoc'

/** Targets offered by "Export → Convert with Pandoc"; `label` is not translated. */
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
 * `gfm` matches what the editor shows, and stays within what pandoc 3.1.3
 * accepts (no `tex_math_gfm`); `-footnotes` keeps a `[^1]` literal unless the
 * editor's footnote preference renders it.
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

const HANT_REGIONS = new Set(['hant', 'tw', 'hk', 'mo'])

/**
 * pandoc knows no `zh`/`zh-CN`/`zh-TW`, and warns about its own translation files
 * for a tag it cannot resolve, so Chinese is spelled with the script subtag.
 */
export const getPandocLanguage = (locale: string): string => {
  const [language, region = ''] = locale.trim().split(/[-_]/)
  if (language?.toLowerCase() !== 'zh') {
    return locale
  }
  return HANT_REGIONS.has(region.toLowerCase()) ? 'zh-Hant' : 'zh-Hans'
}

/**
 * Windows only: the installer can be told not to touch `PATH` and a portable copy
 * never is. macOS/Linux are covered by `patchEnvPath` (#2751).
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

/** Node refuses to spawn a `.bat`/`.cmd` without `shell: true` (CVE-2024-27980). */
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
  /** Folder the document's relative links resolve against, or pandoc uses cwd. */
  cwd?: string
  /** Reader used to parse `input`; see `getPandocReader`. */
  reader?: string
  /** `--metadata key:value` pairs; empty values are dropped. */
  metadata?: Record<string, string>
}

export interface PandocToFileResult {
  /** Pandoc's stderr from a successful run — the warnings exit code 0 would hide. */
  warnings: string
}

/**
 * Convert `input` from markdown and write the result to `outputPath`. The
 * streaming API above cannot serve binary targets: it decodes stdout, and
 * docx/odt/epub are zip containers, so pandoc writes the file itself.
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

    // html5 copies an image `src` verbatim; the binary writers carry the bytes.
    if (to === 'html5') {
      option.push('--embed-resources')
    }
    // pandoc splits `--metadata` on the first colon only, so "Q3: plan" survives.
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
    // An unknown writer exits before draining stdin, and the EPIPE that follows
    // would be an uncaught exception in the main process.
    proc.stdin.on('error', () => {})
    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ warnings: errorOutput.trim() })
      } else {
        // stderr names the offending source position, so prefer it to the code.
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
