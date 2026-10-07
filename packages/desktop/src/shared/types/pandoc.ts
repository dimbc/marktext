/**
 * Which pandoc an export would spawn. Declared once for both processes, so a renamed field
 * fails the renderer's type check instead of arriving as `undefined`.
 */
export interface PandocCommandInfo {
  /** Absolute path of the binary that would run, or `null` when none could be named. */
  command: string | null
  /**
   * True when pandoc exists but no file could be named for it — `PATH` resolves the bare name
   * to a batch shim `spawn` refuses. The pane reports it as found, not as missing.
   */
  found?: boolean
}
