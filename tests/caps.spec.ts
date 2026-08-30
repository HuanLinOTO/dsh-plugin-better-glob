import { describe, expect, it } from 'vitest'
import { DEFAULT_EXCLUDE_DIRS } from '../src/argv.ts'
import { Config, resolveConfig } from '../src/caps.ts'

describe('resolveConfig', () => {
  it('fills every cap from the built-in defaults on an empty config', () => {
    const caps = resolveConfig({})
    expect(caps.excludeDirs).toEqual(DEFAULT_EXCLUDE_DIRS)
    expect(caps.sampleOverCapGlobResults).toBe(false)
    expect(caps.maxResults).toBe(100)
    expect(caps.maxMetaBytes).toBe(65_536)
    expect(caps.rawOutputMaxBytes).toBe(20_000_000)
    expect(caps.graceMs).toBe(3_000)
    expect(caps.stderrMaxBytes).toBe(65_536)
    expect(caps.timeoutMs).toBe(30_000)
  })

  it('honors explicit values', () => {
    const caps = resolveConfig({ excludeDirs: ['node_modules'], globMaxResults: 10, sampleOverCapGlobResults: true })
    expect(caps.excludeDirs).toEqual(['node_modules'])
    expect(caps.maxResults).toBe(10)
    expect(caps.sampleOverCapGlobResults).toBe(true)
  })

  it('rejects separators in excludeDirs names', () => {
    expect(() => resolveConfig({ excludeDirs: ['a/b'] })).toThrow(/bare directory names/)
    expect(() => resolveConfig({ excludeDirs: ['a\\b'] })).toThrow(/bare directory names/)
  })

  it('rejects blank excludeDirs names', () => {
    expect(() => resolveConfig({ excludeDirs: [''] })).toThrow(/bare directory names/)
  })

  it('rejects non-positive caps', () => {
    expect(() => resolveConfig({ globMaxResults: 0 })).toThrow(/globMaxResults/)
    expect(() => resolveConfig({ timeoutMs: -1 })).toThrow(/timeoutMs/)
    expect(() => resolveConfig({ globMaxResults: 1.5 })).toThrow(/globMaxResults/)
  })

  it('rejects a graceMs past the timer-delay ceiling', () => {
    expect(() => resolveConfig({ graceMs: 2_147_483_648 })).toThrow(/graceMs/)
  })
})

describe('Config schema', () => {
  it('applies the same defaults the resolver documents', () => {
    const resolved = Config({})
    expect(resolved.excludeDirs).toEqual(DEFAULT_EXCLUDE_DIRS)
    expect(resolved.globMaxResults).toBe(100)
    expect(resolved.sampleOverCapGlobResults).toBe(false)
  })
})
