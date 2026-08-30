import { describe, expect, it } from 'vitest'
import { pathsMeta, pathsViewFromMeta, renderGlobValue } from '../src/tool.ts'
import type { GlobOutput } from '../src/tool.ts'

const FULL: GlobOutput = {
  root: '.',
  paths: ['src/a.ts', 'src/b.ts'],
  total: 2,
  truncated: false,
  sampled: false,
}

describe('renderGlobValue', () => {
  it('renders an empty result as No files found', () => {
    expect(renderGlobValue({ ...FULL, paths: [], total: 0 })).toBe('No files found')
  })

  it('renders a complete result as the bare path list', () => {
    expect(renderGlobValue(FULL)).toBe('src/a.ts\nsrc/b.ts')
  })

  it('renders a capped page with the head basis and the spill recovery path', () => {
    const text = renderGlobValue({
      ...FULL,
      paths: ['src/a.ts'],
      total: 500,
      truncated: true,
      spill: { locator: 'spill://x', hint: 'read it' },
    })
    expect(text).toContain('src/a.ts\n\n(Showing 1 of 500 paths, the modification-time-ordered head.')
    expect(text).toContain('Full sorted result stored at: spill://x. read it')
  })

  it('names the sampling basis when the page was sampled', () => {
    const text = renderGlobValue({ ...FULL, paths: ['src/a.ts'], total: 500, truncated: true, sampled: true })
    expect(text).toContain('sampled across top-level entries')
  })

  it('falls back to the narrow-the-search message without a spill reference', () => {
    const text = renderGlobValue({ ...FULL, paths: ['src/a.ts'], total: 500, truncated: true })
    expect(text).toContain('could not be saved; narrow pattern or path')
  })
})

describe('pathsMeta', () => {
  it('passes a fitting meta through unchanged', () => {
    expect(pathsMeta(FULL, 65_536)).toEqual({ shape: 'paths', paths: FULL.paths, truncated: false, total: 2 })
  })

  it('drops trailing paths past the byte budget, keeping at least one, and marks truncation', () => {
    const long = 'x'.repeat(100)
    const meta = pathsMeta(
      { ...FULL, paths: [long, long, long], total: 3, truncated: true },
      150,
    )
    expect(meta.paths.length).toBe(1)
    expect(meta.truncated).toBe(true)
    expect(meta.total).toBe(3)
    expect(meta.shape).toBe('paths')
  })
})

describe('pathsViewFromMeta', () => {
  it('round-trips a projected meta into the search card view', () => {
    const meta = pathsMeta(FULL, 65_536)
    expect(pathsViewFromMeta(meta)).toEqual({
      card: 'search',
      shape: 'paths',
      paths: FULL.paths,
      truncated: false,
      total: 2,
    })
  })

  it('narrows a zero-result meta to a valid empty card', () => {
    expect(pathsViewFromMeta({ shape: 'paths', paths: [], truncated: false, total: 0 })).toEqual({
      card: 'search',
      shape: 'paths',
      paths: [],
      truncated: false,
      total: 0,
    })
  })

  it('rejects malformed metadata for the generic-card fallback', () => {
    expect(pathsViewFromMeta(undefined)).toBeUndefined()
    expect(pathsViewFromMeta('nope')).toBeUndefined()
    expect(pathsViewFromMeta({ shape: 'paths' })).toBeUndefined()
    expect(pathsViewFromMeta({ shape: 'paths', paths: [1], truncated: false, total: 1 })).toBeUndefined()
    expect(pathsViewFromMeta({ shape: 'matches', files: [], truncated: false, total: 0 })).toBeUndefined()
  })
})
