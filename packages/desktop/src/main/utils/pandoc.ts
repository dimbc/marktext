// Copy from https://github.com/utatti/simple-pandoc/blob/master/index.js
import { spawn } from 'child_process'
import { accessSync, constants } from 'fs'
import path from 'path'
import type { Readable } from 'stream'
import commandExists from 'command-exists'
import { isFile2 } from 'common/filesystem'
import type { PandocCommandInfo } from '@shared/types/pandoc'

const pandocCommand = 'pandoc'

/** Targets offered by "File → Convert with Pandoc"; `label` is not translated. */
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
  { id: 'textile', label: 'Textile (.textile)', target: 'textile', extension: '.textile' }
])

// These writers have no container to inline an image into: pandoc leaves a plain link.
export const formatLinksMedia = (target: string): boolean =>
  ['latex', 'rst', 'org', 'mediawiki', 'textile'].includes(target)

// What pandoc fetches over the network instead of opening: `https:` or its protocol-
// relative form. A path written with backslashes is a file, and mirrors like a local one.
export const isRemoteMedia = (url: string): boolean => /^(https?:)?\/\//i.test(url)

// Whether the export should carry the document's pictures along (`--extract-media`). It
// replaces a link it cannot read with the alt text, so mirror only the links that resolve: a
// saved document reads relative links from its own folder, an absolute link needs no folder,
// a never-saved one has neither, and a remote picture is downloaded instead (a failed fetch
// costs it). Its own folder needs no copy either: `C:/a` and `C:\a` are the same folder.
export const shouldMirrorMedia = (
  links: string[],
  sourceDir: string | undefined,
  outputPath: string
): boolean =>
  !links.some(isRemoteMedia) &&
  (!!sourceDir || links.every((url) => path.isAbsolute(url))) &&
  (sourceDir === undefined || path.relative(sourceDir, path.dirname(outputPath)) !== '')

// `gfm` matches the editor within what pandoc 3.1.3 accepts (no `tex_math_gfm`);
// `-footnotes` keeps a `[^1]` literal unless the editor's preference renders it.
export const getPandocReader = (superSubScript: boolean, footnotes = true): string =>
  `gfm${superSubScript ? '+superscript+subscript' : ''}${footnotes ? '' : '-footnotes'}`

// pandoc knows no `zh`/`zh-CN` and would warn, so Chinese takes the script subtag.
export const getPandocLanguage = (locale: string): string => {
  const [language, region = ''] = locale.trim().split(/[-_]/)
  if (language?.toLowerCase() !== 'zh') return locale
  return /^(hant|tw|hk|mo)$/i.test(region) ? 'zh-Hant' : 'zh-Hans'
}

// Windows only: the installer can be told not to touch `PATH` and a portable copy never is
// (`patchEnvPath` covers macOS/Linux, #2751). The folder it writes is the one that check
// cannot reach; the shims on `PATH` (chocolatey, scoop, winget) only set the order. The
// arguments let a spec pin both.
export const pandocLocations = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] => {
  if (platform !== 'win32') return []
  return [
    env.ProgramFiles && path.join(env.ProgramFiles, 'Pandoc', 'pandoc.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Pandoc', 'pandoc.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe'),
    env.ProgramData && path.join(env.ProgramData, 'chocolatey', 'bin', 'pandoc.exe'),
    env.USERPROFILE && path.join(env.USERPROFILE, 'scoop', 'shims', 'pandoc.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'pandoc.exe')
  ].filter((candidate): candidate is string => !!candidate)
}

/** Node refuses to spawn a `.bat`/`.cmd` without `shell: true` (CVE-2024-27980). */
const isBatchFile = (filepath: string, platform: NodeJS.Platform): boolean =>
  platform === 'win32' && /\.(bat|cmd)$/i.test(filepath.trim())

/** A `PATH` hit counts only if `spawn` could run it; on Windows `X_OK` is a plain existence check. */
const isRunnable = (filepath: string): boolean => {
  if (!isFile2(filepath)) return false
  try {
    accessSync(filepath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// The file `PATH` would run for `command`, or `null` when it holds none. `command-exists`
// answers this with a boolean and discards the path — the one thing the pane has to name (#2751).
export const findOnPath = (
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string | null => {
  const separator = platform === 'win32' ? ';' : ':'
  // Windows runs a bare name by extension, so the `PATHEXT` spellings are what make it one.
  const suffixes =
    platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']
  for (const folder of (env.PATH ?? '').split(separator)) {
    if (!folder) continue
    for (const suffix of suffixes) {
      const candidate = path.join(folder, `${command}${suffix}`)
      if (!isBatchFile(candidate, platform) && isRunnable(candidate)) return candidate
    }
  }
  return null
}

/** The file this machine would run for pandoc, or `null` when none can be named. */
const locatePandoc = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string | null => {
  const fromEnv = env.MARKTEXT_PANDOC
  if (fromEnv && isFile2(fromEnv) && !isBatchFile(fromEnv, platform)) return fromEnv
  const installed = pandocLocations(platform, env).find((candidate) => isFile2(candidate))
  return installed ?? findOnPath(pandocCommand, platform, env)
}

/** What the preference pane reports; `exists()` can only answer yes or no. */
export const resolvePandocCommand = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): PandocCommandInfo => {
  const command = locatePandoc(platform, env)
  if (command) return { command }
  // A shell also runs the batch shims this lookup skips, so ask before calling pandoc missing.
  return commandExists.sync(pandocCommand) ? { command: null, found: true } : { command: null }
}

// Spawning needs no shell fallback: a batch shim could not be spawned either way.
const getCommand = (): string => locatePandoc() ?? pandocCommand

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

pandoc.exists = (): boolean => resolvePandocCommand().command !== null

export interface PandocToFileOptions {
  /** Folder the document's relative links resolve against, or pandoc uses cwd. */
  cwd?: string
  /** Folder the images are read from once they are mirrored; see `mirrorMedia`. */
  resourcePath?: string
  /** Copy the document's images into the output's folder and rewrite the links. */
  mirrorMedia?: boolean
  /** Reader used to parse `input`; see `getPandocReader`. */
  reader?: string
  metadata?: Record<string, string>
}

export interface PandocToFileResult {
  /** Pandoc's stderr from a successful run — the warnings exit code 0 would hide. */
  warnings: string
}

// Convert `input` to `outputPath`; the streaming API above cannot serve binary targets.
pandoc.toFile = (
  to: string,
  outputPath: string,
  input: string,
  options: PandocToFileOptions = {}
): Promise<PandocToFileResult> =>
  new Promise((resolve, reject) => {
    const { cwd, reader = getPandocReader(false), metadata = {}, resourcePath, mirrorMedia } = options
    const option = ['-f', reader, '-t', to, '-s']
    // pandoc splits `--metadata` on the first colon only, so "Q3: plan" survives.
    for (const [key, value] of Object.entries(metadata)) {
      if (value) option.push(`--metadata=${key}:${value}`)
    }
    if (mirrorMedia) {
      // `--extract-media=.` copies every image pandoc can read — an absolute link
      // included — to the output's folder and rewrites the link to match.
      option.push('--extract-media=.')
      if (resourcePath) option.push(`--resource-path=${resourcePath}`)
    }
    option.push('-o', outputPath)
    // The links pandoc writes are relative to where it runs, so a mirrored export has
    // to run in the folder it is written to.
    const proc = spawn(getCommand(), option, { cwd: mirrorMedia ? path.dirname(outputPath) : cwd })
    let errorOutput = ''
    proc.on('error', reject)
    proc.stderr.on('data', (chunk: Buffer | string) => {
      errorOutput += chunk.toString()
    })
    // An unknown writer exits before draining stdin; the EPIPE would be uncaught.
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

// The links pandoc found, which is what an export mirrors; raw HTML `<img>` is not listed.
export const listLinkedMedia = (input: string, reader: string): Promise<string[]> =>
  new Promise((resolve) => {
    const proc = spawn(getCommand(), ['-f', reader, '-t', 'json'])
    let ast = ''
    proc.stdout.on('data', (chunk: Buffer | string) => {
      ast += chunk.toString()
    })
    proc.stdin.on('error', () => {})
    // A document pandoc cannot parse has nothing to mirror; the conversion says why.
    proc.on('error', () => resolve([]))
    proc.on('close', () => {
      const urls: string[] = []
      try {
        JSON.parse(ast, (_key, node: unknown) => {
          const { t, c } = (node ?? {}) as { t?: string; c?: unknown[] }
          const target = t === 'Image' ? c?.[2] : undefined
          if (Array.isArray(target) && typeof target[0] === 'string') urls.push(target[0])
          return node
        })
      } catch {
        urls.length = 0
      }
      resolve(urls)
    })
    proc.stdin.end(input)
  })

export default pandoc
