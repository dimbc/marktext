import fs from 'fs-extra'
import { ipcMain } from 'electron'
import commandExists from 'command-exists'
import log from 'electron-log'
import { resolvePandocCommand } from '../utils/pandoc'
import type { PandocCommandInfo } from '@shared/types/pandoc'

export const registerCmdHandlers = (): void => {
  ipcMain.handle('mt::cmd::exists', async(_event, name: string) => {
    try {
      if (commandExists.sync(name)) return true

      if (name === 'picgo' && process.platform === 'darwin') {
        const commonPaths = [
          '/usr/local/bin/picgo',
          '/opt/homebrew/bin/picgo',
          `${process.env.HOME}/.npm-global/bin/picgo`,
          `${process.env.HOME}/.npm/bin/picgo`,
          '/usr/local/lib/node_modules/.bin/picgo'
        ]
        for (const p of commonPaths) {
          if (fs.pathExistsSync(p)) return true
        }
      }
      return false
    } catch {
      return false
    }
  })

  // Report the binary an export would spawn: `mt::cmd::exists` only asks `PATH` (#2751).
  ipcMain.handle('mt::pandoc::command', (): PandocCommandInfo => {
    try {
      return resolvePandocCommand()
    } catch (error) {
      // The pane draws no status line when this rejects, so a failed lookup answers "no pandoc".
      log.error('Failed to resolve the pandoc command:', error)
      return { command: null }
    }
  })
}
