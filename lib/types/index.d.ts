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
import type { Context } from '@deepseek-ai/cordis';
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt';
import type { BetterGlobCaps, BetterGlobConfig } from './caps.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "better-glob";
/**
 * Services required by the plugin: `tools`/`systemPrompt` register the
 * shadow into agent scopes, `subprocess` executes ripgrep, `agents` lists
 * live agents for the reload resync.
 */
export declare const inject: string[];
export { Config } from './caps.ts';
export type { BetterGlobConfig } from './caps.ts';
export { buildGlobArgv, DEFAULT_EXCLUDE_DIRS, liftedExcludeNames, parseGlobArgs, VCS_EXCLUDES } from './argv.ts';
export type { GlobInput } from './argv.ts';
export type { GlobOutput, PathsSearchMeta } from './tool.ts';
export { defineBetterGlobTool, pathsMeta, pathsViewFromMeta, renderGlobValue } from './tool.ts';
export { resolveConfig } from './caps.ts';
export type { BetterGlobCaps } from './caps.ts';
/**
 * The prompt section the shadow registers per agent. Same name and order as
 * the built-in `tool:glob` section, so the agent-layer registration shadows
 * the built-in text; the section text names the configured exclusions and
 * the include whitelist escape hatch.
 * @param caps - the deployment's resolved caps.
 * @returns the section to register through `agent.ctx.systemPrompt`.
 */
export declare function shadowSection(caps: BetterGlobCaps): PromptSection;
/**
 * Register the better-`glob` shadow: a `agent/session-start` listener that
 * mounts the tool and prompt section into every agent's own layer, plus a
 * resync over already-live agents so a config reload takes effect without a
 * restart.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param config - the (schemastery-defaulted) plugin configuration.
 */
export declare function apply(ctx: Context, config: BetterGlobConfig): void;
