/**
 * Which pandoc an export would spawn, declared once for both processes so a renamed field
 * fails the renderer's type check instead of arriving as `undefined`.
 */
export interface PandocCommandInfo {
  /** Absolute path of the binary that would run, or `null` when none could be named. */
  command: string | null
}
