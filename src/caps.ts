/**
 * Plugin configuration: the Schemastery schema, the resolved caps, and the
 * load-time validation. Every field defaults, so a patch insert row without
 * a `config` block boots.
 * @module @huanlin/dsh-plugin-better-glob/caps
 */

import z from 'schemastery'
import { DEFAULT_EXCLUDE_DIRS } from './argv.ts'

/** Plugin config; every field has a default. */
export interface BetterGlobConfig {
  /** Bottomless directory NAMES excluded from every search; replaces the built-in default list wholesale (VCS directories are always excluded on top). */
  excludeDirs?: string[]
  /** Whether an over-cap page is sampled across top-level entries instead of taking the modification-time head (the built-in deployment's switch). */
  sampleOverCapGlobResults?: boolean
  /** Max paths one `glob` call retains inline; the complete list spills to a file past it. */
  globMaxResults?: number
  /** Max bytes of serialized `presentationMeta`; trailing paths drop past it. */
  globMetaMaxBytes?: number
  /** Max complete raw `rg` stdout one call parses. */
  rawOutputMaxBytes?: number
  /** Terminate-escalation grace period (ms) for the search process. */
  graceMs?: number
  /** Max bytes of the retained stderr diagnostic tail. */
  stderrMaxBytes?: number
  /** Cooperative tool-call timeout budget (ms). */
  timeoutMs?: number
}

export const Config: z<BetterGlobConfig> = z.object({
  excludeDirs: z.array(z.string())
    .default([...DEFAULT_EXCLUDE_DIRS])
    .description('Bottomless directory names excluded from every glob search. Replaces the default list wholesale; VCS directories (.git etc.) are always excluded on top. include lifts a name back into one call.'),
  sampleOverCapGlobResults: z.boolean()
    .default(false)
    .description('Whether an over-cap glob page is sampled across top-level entries instead of taking the modification-time head.'),
  globMaxResults: z.number()
    .default(100)
    .description('Max paths one glob call retains inline; the complete list spills to a file past it.'),
  globMetaMaxBytes: z.number()
    .default(65_536)
    .description('Max bytes of one glob result\'s serialized presentationMeta; trailing paths drop past it.'),
  rawOutputMaxBytes: z.number()
    .default(20_000_000)
    .description('Max complete raw rg stdout one call parses.'),
  graceMs: z.number()
    .default(3_000)
    .description('Terminate-escalation grace period (ms) for the search process.'),
  stderrMaxBytes: z.number()
    .default(65_536)
    .description('Max bytes of the retained stderr diagnostic tail.'),
  timeoutMs: z.number()
    .default(30_000)
    .description('Cooperative tool-call timeout budget (ms).'),
})

/** Resolved caps after schemastery defaulting — every field required. */
export interface BetterGlobCaps {
  excludeDirs: readonly string[]
  sampleOverCapGlobResults: boolean
  maxResults: number
  maxMetaBytes: number
  rawOutputMaxBytes: number
  graceMs: number
  stderrMaxBytes: number
  timeoutMs: number
}

/** The `@deepseek-ai/dsh-timeout` MAX_TIMER_DELAY_MS (2^31-1), inlined to keep the peer set minimal. */
const MAX_GRACE_MS = 2_147_483_647

/** Every cap counts items/bytes/milliseconds — a positive integer, or retention and timeout arithmetic misbehaves silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`better-glob: ${name} must be a positive integer`)
  }
}

/**
 * Validate the schemastery-defaulted config into caps. Fails loud at load:
 * excludeDirs entries must be bare directory names (a separator or a blank
 * name would silently never match a directory in the traversal globs), caps
 * must be positive integers, and graceMs must fit a timer delay.
 * @param config - the schemastery-defaulted plugin config.
 * @returns the resolved caps.
 */
export function resolveConfig(config: BetterGlobConfig): BetterGlobCaps {
  const excludeDirs = config.excludeDirs ?? [...DEFAULT_EXCLUDE_DIRS]
  for (const name of excludeDirs) {
    if (name.length === 0 || name.includes('/') || name.includes('\\')) {
      throw new Error(`better-glob: excludeDirs entries must be bare directory names without path separators, got ${JSON.stringify(name)}`)
    }
  }
  const maxResults = config.globMaxResults ?? 100
  const maxMetaBytes = config.globMetaMaxBytes ?? 65_536
  const rawOutputMaxBytes = config.rawOutputMaxBytes ?? 20_000_000
  const graceMs = config.graceMs ?? 3_000
  const stderrMaxBytes = config.stderrMaxBytes ?? 65_536
  const timeoutMs = config.timeoutMs ?? 30_000
  assertPositiveInteger('globMaxResults', maxResults)
  assertPositiveInteger('globMetaMaxBytes', maxMetaBytes)
  assertPositiveInteger('rawOutputMaxBytes', rawOutputMaxBytes)
  assertPositiveInteger('graceMs', graceMs)
  if (graceMs > MAX_GRACE_MS) {
    throw new Error(`better-glob: graceMs must be no greater than ${MAX_GRACE_MS}`)
  }
  assertPositiveInteger('stderrMaxBytes', stderrMaxBytes)
  assertPositiveInteger('timeoutMs', timeoutMs)
  return {
    excludeDirs,
    sampleOverCapGlobResults: config.sampleOverCapGlobResults ?? false,
    maxResults,
    maxMetaBytes,
    rawOutputMaxBytes,
    graceMs,
    stderrMaxBytes,
    timeoutMs,
  }
}
