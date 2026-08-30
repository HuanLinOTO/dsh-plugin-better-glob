import { describe, expect, it } from 'vitest'
import { buildGlobArgv, DEFAULT_EXCLUDE_DIRS, liftedExcludeNames, parseGlobArgs, VCS_EXCLUDES } from '../src/argv.ts'

describe('parseGlobArgs', () => {
  it('keeps a valid pattern/path/include input unchanged', () => {
    expect(parseGlobArgs({ pattern: '**/*.ts', path: 'src', include: ['node_modules/**'] })).toEqual({
      pattern: '**/*.ts',
      path: 'src',
      include: ['node_modules/**'],
    })
  })

  it('omits absent optional fields', () => {
    expect(parseGlobArgs({ pattern: '*.js' })).toEqual({ pattern: '*.js' })
  })

  it('rejects a blank pattern', () => {
    expect(() => parseGlobArgs({ pattern: '   ' })).toThrow(/pattern/)
  })

  it('rejects a blank path', () => {
    expect(() => parseGlobArgs({ pattern: '*', path: ' ' })).toThrow(/path/)
  })

  it('rejects a blank include entry', () => {
    expect(() => parseGlobArgs({ pattern: '*', include: ['node_modules/**', '  '] })).toThrow(/include/)
  })
})

describe('liftedExcludeNames', () => {
  const dirs = ['node_modules', 'dist', '.venv']

  it('lifts nothing without include', () => {
    expect(liftedExcludeNames(undefined, dirs)).toEqual(new Set())
  })

  it('lifts a directory named as a path segment', () => {
    expect(liftedExcludeNames(['node_modules/**/package.json'], dirs)).toEqual(new Set(['node_modules']))
  })

  it('lifts a directory named anywhere in the pattern, including leading segments and dot names', () => {
    expect(liftedExcludeNames(['**/.venv/bin/python'], dirs)).toEqual(new Set(['.venv']))
    expect(liftedExcludeNames(['dist/x'], dirs)).toEqual(new Set(['dist']))
  })

  it('lifts every candidate for a wildcard-only pattern', () => {
    expect(liftedExcludeNames(['**'], dirs)).toEqual(new Set(dirs))
    expect(liftedExcludeNames(['*'], dirs)).toEqual(new Set(dirs))
    expect(liftedExcludeNames(['**/*'], dirs)).toEqual(new Set(dirs))
  })

  it('ignores segments that name no configured exclusion', () => {
    expect(liftedExcludeNames(['src/**'], dirs)).toEqual(new Set())
  })

  it('unions the lifts of multiple patterns', () => {
    expect(liftedExcludeNames(['node_modules/a', 'dist/b'], dirs)).toEqual(new Set(['node_modules', 'dist']))
  })
})

describe('buildGlobArgv', () => {
  it('matches the built-in discovery contract: files, pattern, mtime order, ignore/hidden search', () => {
    const argv = buildGlobArgv({ pattern: '**/*.ts' }, DEFAULT_EXCLUDE_DIRS)
    expect(argv.slice(0, 5)).toEqual(['--files', '--glob=**/*.ts', '--sort=modified', '--no-ignore', '--hidden'])
  })

  it('always excludes VCS directories, with the two-glob prune/contents pattern', () => {
    const argv = buildGlobArgv({ pattern: '*' }, [])
    for (const name of VCS_EXCLUDES) {
      expect(argv).toContain(`--glob=!**/${name}`)
      expect(argv).toContain(`--glob=!**/${name}/**`)
    }
  })

  it('excludes every configured directory by default', () => {
    const argv = buildGlobArgv({ pattern: '*' }, ['node_modules', 'dist'])
    expect(argv).toContain('--glob=!**/node_modules')
    expect(argv).toContain('--glob=!**/node_modules/**')
    expect(argv).toContain('--glob=!**/dist')
    expect(argv).toContain('--glob=!**/dist/**')
  })

  it('omits both globs of a lifted directory and keeps the rest', () => {
    const argv = buildGlobArgv({ pattern: '**/package.json', include: ['node_modules/**/package.json'] }, ['node_modules', 'dist'])
    expect(argv).not.toContain('--glob=!**/node_modules')
    expect(argv).not.toContain('--glob=!**/node_modules/**')
    expect(argv).toContain('--glob=!**/dist')
    expect(argv).not.toContain('--glob=node_modules/**/package.json')
  })

  it('lifts every configured directory for a wildcard-only include, never the VCS set', () => {
    const argv = buildGlobArgv({ pattern: '*', include: ['**'] }, ['node_modules', 'dist'])
    expect(argv).not.toContain('--glob=!**/node_modules')
    expect(argv).not.toContain('--glob=!**/dist')
    expect(argv).toContain('--glob=!**/.git')
    expect(argv).toContain('--glob=!**/.git/**')
  })

  it('rides the search root behind --', () => {
    const argv = buildGlobArgv({ pattern: '*', path: '-weird-dir' }, [])
    expect(argv[argv.length - 2]).toBe('--')
    expect(argv[argv.length - 1]).toBe('-weird-dir')
  })

  it('omits the root for a workspace search', () => {
    const argv = buildGlobArgv({ pattern: '*' }, [])
    expect(argv).not.toContain('--')
  })
})
