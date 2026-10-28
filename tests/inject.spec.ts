import { describe, expect, it } from 'vitest'
import { inject as builtinInject } from '@deepseek-ai/dsh-tool-fs-search'
import { inject } from '../src/index.ts'

/**
 * The shadow reuses the built-in search suite's execution plumbing
 * (`runRipgrep`, `toWorkdirRelative`, `trySaveFormattedResult`), so it
 * resolves every service that plumbing reads through the plugin context.
 * A service the built-in plugin injects but the shadow omits throws
 * `cannot get property "<name>" without inject` on the first tool call —
 * at execution time, where no unit test of the definition reaches it.
 */
describe('better-glob service injection', () => {
  it('declares every service the built-in search suite requires', () => {
    expect([...inject]).toEqual(expect.arrayContaining([...builtinInject]))
  })

  it('resolves the agent working directory that runRipgrep reads', () => {
    expect(inject).toContain('workingDirectory')
  })
})
