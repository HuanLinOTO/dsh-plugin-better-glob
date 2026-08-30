/**
 * The better `glob` tool definition: the model-facing schema (with the
 * `include` whitelist), execution over the packaged ripgrep binary through
 * the built-in search suite's spawn plumbing, inline-cap + spill retention,
 * and the model/card projections. Registration happens per agent (see
 * `index.ts`); this module only builds the definition.
 * @module @huanlin/dsh-plugin-better-glob/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SearchResultView, ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { runRipgrep, sampleAcrossTopLevel, toWorkdirRelative, trySaveFormattedResult } from '@deepseek-ai/dsh-tool-fs-search'
import { buildGlobArgv, parseGlobArgs } from './argv.ts'
import type { BetterGlobCaps } from './caps.ts'

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
  root: string
  /** The retained page of matching paths, in modification-time order. */
  paths: string[]
  /** How many paths the complete search found. */
  total: number
  /** Whether `paths` is a capped page rather than the complete result. */
  truncated: boolean
  /** Whether an over-cap page was sampled across top-level entries (only meaningful when `truncated`). */
  sampled: boolean
  /** Where the complete sorted result was saved, when the spill backend accepted it. */
  spill?: { locator: string; hint: string }
}

/** The `glob` tool's private `tool/result` meta payload: the search card's path list (object-literal alias for `JsonValue` assignability). */
export type PathsSearchMeta = { shape: 'paths'; paths: string[]; truncated: boolean; total: number }

/** The serialized UTF-8 byte size of one meta payload (the size persisted and re-sent). */
function metaBytes(meta: PathsSearchMeta): number {
  return Buffer.byteLength(JSON.stringify(meta), 'utf8')
}

/**
 * Drop trailing paths until the serialized meta fits `maxMetaBytes`, marking
 * the result `truncated` when anything was dropped. `total` is preserved. A
 * single path too large to fit on its own is kept: the invariant is a bounded
 * payload wherever droppable, never an empty card that hides a real result.
 */
function capMetaBytes(meta: PathsSearchMeta, maxMetaBytes: number): PathsSearchMeta {
  if (metaBytes(meta) <= maxMetaBytes) return meta
  const paths = [...meta.paths]
  while (paths.length > 1 && metaBytes({ ...meta, paths, truncated: true }) > maxMetaBytes) paths.pop()
  return { ...meta, paths, truncated: true }
}

/** Project one canonical value into the bounded `presentationMeta` the search card renders. */
export function pathsMeta(value: GlobOutput, maxMetaBytes: number): PathsSearchMeta {
  return capMetaBytes(
    { shape: 'paths', paths: value.paths, truncated: value.truncated, total: value.total },
    maxMetaBytes,
  )
}

/**
 * Narrow opaque live or replayed result metadata to a {@link SearchResultView}.
 * Malformed metadata returns `undefined` so `presentResult` falls back to the
 * generic card instead of throwing during replay of an older or hand-edited
 * log. A zero-result meta narrows to a valid empty card.
 * @param meta - result metadata (the {@link PathsSearchMeta} the tool projected).
 * @returns the search view, or `undefined` for absent or malformed metadata.
 */
export function pathsViewFromMeta(meta: unknown): SearchResultView | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const record = meta as Record<string, unknown>
  const { truncated, total } = record
  if (typeof truncated !== 'boolean' || typeof total !== 'number') return undefined
  if (record.shape !== 'paths') return undefined
  const { paths } = record
  if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string')) return undefined
  return { card: 'search', shape: 'paths', paths, truncated, total }
}

/** Format one canonical value for the Native surface: the page, plus the cap basis and recovery path when capped. */
export function renderGlobValue(value: GlobOutput): string {
  if (value.paths.length === 0) return 'No files found'
  const body = value.paths.join('\n')
  if (!value.truncated) return body
  const basis = value.sampled
    ? ', sampled across top-level entries instead of taken in modification-time order'
    : ', the modification-time-ordered head'
  const recovery = value.spill !== undefined
    ? `Full sorted result stored at: ${value.spill.locator}. ${value.spill.hint}`
    : 'The complete result could not be saved; narrow pattern or path to see more.'
  return `${body}\n\n(Showing ${value.paths.length} of ${value.total} paths${basis}. ${recovery})`
}

/**
 * Build the better `glob` tool definition.
 * @param ctx - the plugin context; execution reads its `subprocess` service and opportunistic `spillStore`.
 * @param caps - the deployment's resolved caps (plugin config after defaulting).
 * @returns the registry-ready definition; the caller registers it into agent scopes.
 */
export function defineBetterGlobTool(ctx: Context, caps: BetterGlobCaps): ToolDefinition {
  const overCapDescription = caps.sampleOverCapGlobResults
    ? `a larger result instead returns ${caps.maxResults} paths sampled across top-level entries`
    : `a larger result returns the first ${caps.maxResults} paths in modification-time order`
  const excludedNote = caps.excludeDirs.length > 0
    ? `Bottomless directories are excluded automatically (${caps.excludeDirs.join(', ')}); pass include to search inside one.`
    : 'No directories are excluded by configuration.'
  return defineTool({
    name: 'glob',
    description: 'Find files whose paths match a glob pattern. Returns matching file paths — never directories — '
      + 'in modification-time order, including hidden and ignored files (VCS metadata directories are always excluded). '
      + `Up to ${caps.maxResults} paths come back inline; ${overCapDescription}, `
      + 'says so, and reports where the complete sorted list was saved. This tool does not enumerate directory entries. '
      + excludedNote,
    parameters: {
      pattern: {
        type: 'string',
        required: true,
        description: 'Glob pattern to match file paths against (e.g. "**/*.ts", "src/**/*.test.js"). '
          + 'A pattern with no "/" matches the basename at any depth, so "*" and "*.ts" both search the whole tree; include a separator to anchor the depth.',
      },
      path: {
        type: 'string',
        description: 'Directory to search in. Defaults to the session workspace; a relative path resolves against it.',
      },
      include: {
        type: 'array',
        items: { type: 'string' },
        description: 'Whitelist that lifts excluded directories back into THIS search: an include pattern naming an '
          + 'excluded directory as a path segment (e.g. "node_modules/**/package.json") removes that directory from the '
          + 'exclusion set; a bare wildcard pattern ("**") lifts every excluded directory. include never filters results '
          + '— pattern does. Omit it for ordinary searches.',
      },
    },
    timeoutMs: caps.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          paths: { type: 'array', required: true, items: { type: 'string' } },
          total: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          sampled: { type: 'boolean', required: true },
          spill: {
            type: 'object',
            additionalProperties: false,
            properties: {
              locator: { type: 'string', required: true },
              hint: { type: 'string', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderGlobValue(value as GlobOutput) }],
      presentationMeta: (_args, value) => pathsMeta(value as GlobOutput, caps.maxMetaBytes),
    },
    async execute(args, exec) {
      const input = parseGlobArgs(args as { pattern: string; path?: string; include?: string[] })
      const run = await runRipgrep(ctx, exec, 'glob', buildGlobArgv(input, caps.excludeDirs), caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
      const root = input.path === undefined ? '.' : toWorkdirRelative(input.path, run.workdir)
      const all: string[] = []
      if (!run.noMatches) {
        for (const line of run.stdout.split('\n')) {
          if (line.length === 0) continue
          all.push(toWorkdirRelative(line, run.workdir))
        }
      }
      if (all.length <= caps.maxResults) {
        return { root, paths: all, total: all.length, truncated: false, sampled: false }
      }
      const page = caps.sampleOverCapGlobResults
        ? sampleAcrossTopLevel(all, caps.maxResults, root).items
        : all.slice(0, caps.maxResults)
      const spillRef = await trySaveFormattedResult(ctx, exec, 'glob-results.txt', all.join('\n'))
      return {
        root,
        paths: page,
        total: all.length,
        truncated: true,
        sampled: caps.sampleOverCapGlobResults,
        ...(spillRef !== undefined ? { spill: { locator: spillRef.locator, hint: spillRef.retrievalHint } } : {}),
      }
    },
    presentCall: args => {
      const where = args.path !== undefined ? ` in ${args.path}` : ''
      return { card: 'generic', title: `Glob ${args.pattern}${where}`, kind: 'search', rawInput: args.pattern }
    },
    presentResult: (_args, result: ToolResult) => {
      if (result.isError) return undefined
      return pathsViewFromMeta(result.meta)
    },
  })
}
