import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * `static/preference.json` is the list of known settings — `Preference.init()` deletes every
 * user key that is not in it. A preference declared only in the schema is therefore wiped on
 * each start and comes back as the schema default, so the switch flips itself off again.
 */

const DEFAULTS_PATH = path.join(__dirname, '../../../static/preference.json')
const SCHEMA_PATH = path.join(__dirname, '../../../src/main/preferences/schema.json')

interface SchemaEntry {
  type?: string
  default?: unknown
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

  // The schema default is what a pruned key comes back as, and what PREFERENCES.md publishes;
  // the file holds what the first start writes. Nothing at runtime compares the two.
  it('gives every schema key the value the schema calls its default', () => {
    // Compared as JSON: a list or object default has to match by content, not by identity.
    const diverged = Object.entries(schema)
      .filter(
        ([key, entry]) =>
          key in defaults &&
          'default' in entry &&
          JSON.stringify(defaults[key]) !== JSON.stringify(entry.default)
      )
      .map(
        ([key, entry]) =>
          `${key}: schema says ${JSON.stringify(entry.default)}, the file says ${JSON.stringify(
            defaults[key]
          )}`
      )
    expect(diverged).toEqual([])
  })

  // The mirror image: a key the file carries but the schema never declares is written and read
  // with no type validation and no default to fall back on.
  it('carries no key that the schema does not declare', () => {
    const undeclared = Object.keys(defaults).filter((key) => !(key in schema))
    expect(
      undeclared,
      `declare these in schema.json or drop them from static/preference.json: ${undeclared.join(
        ', '
      )}`
    ).toEqual([])
  })
})
