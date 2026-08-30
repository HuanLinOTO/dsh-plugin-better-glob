/**
 * dsh-plugin-better-glob — per-agent shadow replacement for the built-in
 * `glob` tool.
 *
 * ## Why per-agent registration
 *
 * The tools registry resolves a scope's view by layering: a scope's OWN
 * registrations shadow every inherited one (the global layer in headless
 * compositions, the preset's standing scope in web profiles, where the
 * web-app bundle disables the host-plane row and the `standard` preset mounts
 * `tool-fs-search` per session). A global registration cannot win in either
 * composition, and a bundle patch cannot reach preset files — so the shadow
 * registers into each agent's own layer (`agent.ctx`), which beats both.
 * `grep` is untouched, and no built-in rows are disabled.
 *
 * ## Mount points
 *
 * `agent/session-start` fires for every agent (main and subagents) before the
 * first prompt assembly, across startup/resume/clear/compact — each agent
 * gets the shadow exactly once, guarded by a WeakSet. On plugin reload
 * (config change), `apply` re-runs on the same module instance: live agents
 * listed from the `agents` registry have their previous shadow disposed and
 * re-registered so the fresh config applies.
 *
 * ## Execution
 *
 * The tool reuses the built-in search suite's spawn plumbing (`runRipgrep`,
 * `toWorkdirRelative`, `trySaveFormattedResult`, `sampleAcrossTopLevel`) —
 * same packaged ripgrep binary, same subprocess seam, same error vocabulary.
 * Its own contribution is the exclusion set (VCS always + configurable
 * bottomless directories) and the `include` whitelist that lifts an excluded
 * directory back into one call at argv-construction time.
 * @module @huanlin/dsh-plugin-better-glob
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { BetterGlobCaps, BetterGlobConfig } from './caps.ts'
import { resolveConfig } from './caps.ts'
import { defineBetterGlobTool } from './tool.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'better-glob'

/**
 * Services required by the plugin: `tools`/`systemPrompt` register the
 * shadow into agent scopes, `subprocess` executes ripgrep, `agents` lists
 * live agents for the reload resync.
 */
export const inject = ['tools', 'systemPrompt', 'subprocess', 'agents']

export { Config } from './caps.ts'
export type { BetterGlobConfig } from './caps.ts'
export { buildGlobArgv, DEFAULT_EXCLUDE_DIRS, liftedExcludeNames, parseGlobArgs, VCS_EXCLUDES } from './argv.ts'
export type { GlobInput } from './argv.ts'
export type { GlobOutput, PathsSearchMeta } from './tool.ts'
export { defineBetterGlobTool, pathsMeta, pathsViewFromMeta, renderGlobValue } from './tool.ts'
export { resolveConfig } from './caps.ts'
export type { BetterGlobCaps } from './caps.ts'

/**
 * The prompt section the shadow registers per agent. Same name and order as
 * the built-in `tool:glob` section, so the agent-layer registration shadows
 * the built-in text; the section text names the configured exclusions and
 * the include whitelist escape hatch.
 * @param caps - the deployment's resolved caps.
 * @returns the section to register through `agent.ctx.systemPrompt`.
 */
export function shadowSection(caps: BetterGlobCaps): PromptSection {
  const excluded = caps.excludeDirs.length > 0
    ? `Bottomless directories (${caps.excludeDirs.join(', ')}) are excluded automatically — pass include (for example ["node_modules/**"]) when a search must look inside one.`
    : 'No directories are excluded by configuration.'
  return {
    name: 'tool:glob',
    order: FIRST_PARTY_SECTION_ORDER.TOOL_GLOB,
    text: 'Use the glob tool — not shell find — to discover files by path pattern. A pattern with no "/" matches basenames at any depth, so "*" matches every file in the tree rather than its top level. '
      + 'Results are files only, never directories, and include hidden and ignored files. '
      + excluded
      + ' A result that fits comes back in modification-time order.',
  }
}

/** Register the shadow into one agent's own layer; returns the combined disposer for reload resync. */
function shadowAgent(agent: Agent, tool: ToolDefinition, section: PromptSection): () => void {
  const disposeTool = agent.ctx.tools.register(tool)
  const disposeSection = agent.ctx.systemPrompt.section(section)
  return () => {
    disposeTool()
    disposeSection()
  }
}

/**
 * Per-agent shadow registrations, module-level so a config reload (the same
 * module instance re-running `apply`) can dispose the previous fiber's
 * registration before re-registering with the fresh config.
 */
const shadowed = new WeakMap<Agent, () => void>()

/**
 * Register the better-`glob` shadow: a `agent/session-start` listener that
 * mounts the tool and prompt section into every agent's own layer, plus a
 * resync over already-live agents so a config reload takes effect without a
 * restart.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param config - the (schemastery-defaulted) plugin configuration.
 */
export function apply(ctx: Context, config: BetterGlobConfig): void {
  const caps = resolveConfig(config)
  const tool = defineBetterGlobTool(ctx, caps)
  const section = shadowSection(caps)

  const shadow = (agent: Agent): void => {
    if (shadowed.has(agent)) return
    shadowed.set(agent, shadowAgent(agent, tool, section))
  }

  ctx.on('agent/session-start', ({ agent }) => {
    shadow(agent)
  })

  // Agents created before this apply (a config reload) keep the previous
  // fiber's shadow: dispose it first so the fresh config takes over.
  for (const agent of ctx.agents.list()) {
    shadowed.get(agent)?.()
    shadowed.delete(agent)
    shadow(agent)
  }
}
