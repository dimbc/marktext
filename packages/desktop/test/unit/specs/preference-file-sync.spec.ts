import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Preference defaults stay in sync with the schema.
 *
 * `static/preference.json` is the list of *known* settings. `Preference.init()` reads it
 * as `defaultSettings` and then, on every start with an existing `preferences.json`,
 * deletes every user key that is not in that list:
 *
 *     for (const key of userSettingKeys) {
 *       if (!defaultSettingKeys.includes(key)) { delete userSetting[key]; this.store.delete(key) }
 *     }
 *
 * So a preference declared only in the schema is wiped on the next start. It does not
 * look wiped: `electron-store` merges the schema defaults back in, so the app reads the
 * default value (e.g. `false`) and the settings switch flips itself off every restart.
 *
 * Adding a preference means touching four places, and this spec guards the one that is
 * easy to miss:
 *   - `src/main/preferences/schema.json`        (type + default) — validated by electron-store
 *   - `static/preference.json`                  (known-key list) — THIS FILE, checked below
 *   - `src/shared/types/preferences.ts`         (IUserPreferences)
 *   - `src/renderer/src/store/preferences.ts`   (PreferencesState + initial state)
 *
 * Extra keys on the defaults side are allowed: `treePathExcludePatterns` predates the
 * schema and is still carried there.
 */

const DEFAULTS_PATH = path.join(__dirname, '../../../static/preference.json')
const SCHEMA_PATH = path.join(__dirname, '../../../src/main/preferences/schema.json')

interface SchemaEntry {
  type?: string
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, SchemaEntry>
const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8')) as Record<string, unknown>

const typeOf = (value: unknown): string => {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

describe('static/preference.json stays in sync with the preference schema', () => {
  it('lists every key the schema declares, so no setting is dropped on restart', () => {
    const missing = Object.keys(schema).filter((key) => !(key in defaults))
    expect(missing, `add these keys to static/preference.json: ${missing.join(', ')}`).toEqual([])
  })

  it('gives every schema key a value of the type the schema declares', () => {
    const mismatched = Object.entries(schema)
      .filter(
        ([key, entry]) =>
          Boolean(entry.type) && key in defaults && typeOf(defaults[key]) !== entry.type
      )
      .map(([key, entry]) => `${key}: expected ${entry.type}, got ${typeOf(defaults[key])}`)
    expect(mismatched).toEqual([])
  })
})
