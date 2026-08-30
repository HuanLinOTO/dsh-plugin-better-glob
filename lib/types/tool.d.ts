/**
 * The better `glob` tool definition: the model-facing schema (with the
 * `include` whitelist), execution over the packaged ripgrep binary through
 * the built-in search suite's spawn plumbing, inline-cap + spill retention,
 * and the model/card projections. Registration happens per agent (see
 * `index.ts`); this module only builds the definition.
 * @module @huanlin/dsh-plugin-better-glob/tool
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SearchResultView, ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { BetterGlobCaps } from './caps.ts';
/**
 * The canonical value of one `glob` call: the retained inline page plus the
 * recovery info for a capped result. The complete modification-time-ordered
 * list exists only in the spill file (when the cap bit and the spill backend
 * accepted it); the canonical value stays bounded for the session log.
 *
 * Object-literal type aliases rather than interfaces: only an alias is
 * assignable to the `JsonValue` index signature the tool contract uses.
 */
export type GlobOutput = {
    /** The search root in the same display-path space as `paths`. */
    root: string;
    /** The retained page of matching paths, in modification-time order. */
    paths: string[];
    /** How many paths the complete search found. */
    total: number;
    /** Whether `paths` is a capped page rather than the complete result. */
    truncated: boolean;
    /** Whether an over-cap page was sampled across top-level entries (only meaningful when `truncated`). */
    sampled: boolean;
    /** Where the complete sorted result was saved, when the spill backend accepted it. */
    spill?: {
        locator: string;
        hint: string;
    };
};
/** The `glob` tool's private `tool/result` meta payload: the search card's path list (object-literal alias for `JsonValue` assignability). */
export type PathsSearchMeta = {
    shape: 'paths';
    paths: string[];
    truncated: boolean;
    total: number;
};
/** Project one canonical value into the bounded `presentationMeta` the search card renders. */
export declare function pathsMeta(value: GlobOutput, maxMetaBytes: number): PathsSearchMeta;
/**
 * Narrow opaque live or replayed result metadata to a {@link SearchResultView}.
 * Malformed metadata returns `undefined` so `presentResult` falls back to the
 * generic card instead of throwing during replay of an older or hand-edited
 * log. A zero-result meta narrows to a valid empty card.
 * @param meta - result metadata (the {@link PathsSearchMeta} the tool projected).
 * @returns the search view, or `undefined` for absent or malformed metadata.
 */
export declare function pathsViewFromMeta(meta: unknown): SearchResultView | undefined;
/** Format one canonical value for the Native surface: the page, plus the cap basis and recovery path when capped. */
export declare function renderGlobValue(value: GlobOutput): string;
/**
 * Build the better `glob` tool definition.
 * @param ctx - the plugin context; execution reads its `subprocess` service and opportunistic `spillStore`.
 * @param caps - the deployment's resolved caps (plugin config after defaulting).
 * @returns the registry-ready definition; the caller registers it into agent scopes.
 */
export declare function defineBetterGlobTool(ctx: Context, caps: BetterGlobCaps): ToolDefinition;
