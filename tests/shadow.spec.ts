import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from '../src/caps.ts'
import { apply } from '../src/index.ts'

/** A stand-in for the built-in `glob` registration: same name, same section name, none of the behavior. */
const BASE_GLOB: ToolDefinition = {
  name: 'glob',
  description: 'built-in glob',
  parameters: { type: 'object', properties: {} },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  },
  execute: () => Promise.resolve('built-in'),
}

/** Mount the real registry (with its systemPrompt dependency) on a fresh context. */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** Mint a scope whose key doubles as a minimal Agent object (the key carries the scope's context, as a real Agent does). */
async function mintAgentScope(ctx: Context, name: string): Promise<{ scope: Scope; key: Agent }> {
  const key = { id: `${name}` as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, key)
  }, { inject: ['tools', 'systemPrompt'] }))
  ;(key as { ctx?: Context }).ctx = scope.ctx
  return { scope, key }
}

/** Register the fake built-in tool and prompt section at the host plane. */
function installBase(ctx: Context): void {
  ctx.tools.register(BASE_GLOB)
  ctx.systemPrompt.section({ name: 'tool:glob', order: 1400, text: 'BUILTIN GLOB SECTION' })
}

describe('better-glob shadow (real ToolRuntime composition)', () => {
  it('shadows the built-in glob for an agent after session-start, leaving the global view intact', async () => {
    const ctx = await mount()
    installBase(ctx)
    ctx.provide('agents', { list: () => [] })
    apply(ctx, {})
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.emit('agent/session-start', { agent: key, source: 'startup' })

    expect(ctx.tools.get('glob', key)?.description).toContain('include')
    expect(ctx.tools.get('glob', key)?.description).not.toBe('built-in glob')
    expect(ctx.tools.get('glob')?.description).toBe('built-in glob')
    expect(ctx.tools.schemas(key).filter(t => t.name === 'glob')).toHaveLength(1)

    const scoped = await ctx.systemPrompt.assemble({ scope: key })
    expect(scoped.sections.find(s => s.name === 'tool:glob')?.text).toContain('include')
    const global = await ctx.systemPrompt.assemble()
    expect(global.sections.find(s => s.name === 'tool:glob')?.text).toBe('BUILTIN GLOB SECTION')

    await scope.dispose()
    expect(ctx.tools.get('glob', key)?.description).toBe('built-in glob')
  })

  it('does not leak the shadow to agents that never started', async () => {
    const ctx = await mount()
    installBase(ctx)
    ctx.provide('agents', { list: () => [] })
    apply(ctx, {})
    const { scope, key } = await mintAgentScope(ctx, 'started')
    const other = await mintAgentScope(ctx, 'other')
    ctx.emit('agent/session-start', { agent: key, source: 'startup' })

    expect(ctx.tools.get('glob', key)?.description).toContain('include')
    expect(ctx.tools.get('glob', other.key)?.description).toBe('built-in glob')
    await scope.dispose()
    await other.scope.dispose()
  })

  it('re-firing session-start stays idempotent', async () => {
    const ctx = await mount()
    installBase(ctx)
    ctx.provide('agents', { list: () => [] })
    apply(ctx, {})
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.emit('agent/session-start', { agent: key, source: 'startup' })
    ctx.emit('agent/session-start', { agent: key, source: 'clear' })
    ctx.emit('agent/session-start', { agent: key, source: 'compact' })

    expect(ctx.tools.schemas(key).filter(t => t.name === 'glob')).toHaveLength(1)
    await scope.dispose()
  })

  it('resyncs live agents on reload: a fresh apply replaces the previous shadow with the new config', async () => {
    const ctx = await mount()
    installBase(ctx)
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.provide('agents', { list: () => [key] })

    apply(ctx, { globMaxResults: 100 })
    expect(ctx.tools.get('glob', key)?.description).toContain('Up to 100 paths')

    apply(ctx, { globMaxResults: 55 })
    expect(ctx.tools.get('glob', key)?.description).toContain('Up to 55 paths')
    expect(ctx.tools.schemas(key).filter(t => t.name === 'glob')).toHaveLength(1)
    await scope.dispose()
  })

  it('the registered shadow carries the include parameter in its model-facing schema', async () => {
    const ctx = await mount()
    installBase(ctx)
    ctx.provide('agents', { list: () => [] })
    apply(ctx, resolveConfig({}))
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.emit('agent/session-start', { agent: key, source: 'startup' })

    const schema = ctx.tools.schemas(key).find(t => t.name === 'glob')
    expect(schema).toBeDefined()
    const properties = (schema?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(['pattern', 'path', 'include']))
    await scope.dispose()
  })
})
