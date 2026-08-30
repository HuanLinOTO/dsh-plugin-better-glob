/**
 * Plugin configuration: the Schemastery schema, the resolved caps, and the
 * load-time validation. Every field defaults, so a patch insert row without
 * a `config` block boots.
 * @module @huanlin/dsh-plugin-better-glob/caps
 */
import z from 'schemastery';
/** Plugin config; every field has a default. */
export interface BetterGlobConfig {
    /** Bottomless directory NAMES excluded from every search; replaces the built-in default list wholesale (VCS directories are always excluded on top). */
    excludeDirs?: string[];
    /** Whether an over-cap page is sampled across top-level entries instead of taking the modification-time head (the built-in deployment's switch). */
    sampleOverCapGlobResults?: boolean;
    /** Max paths one `glob` call retains inline; the complete list spills to a file past it. */
    globMaxResults?: number;
    /** Max bytes of serialized `presentationMeta`; trailing paths drop past it. */
    globMetaMaxBytes?: number;
    /** Max complete raw `rg` stdout one call parses. */
    rawOutputMaxBytes?: number;
    /** Terminate-escalation grace period (ms) for the search process. */
    graceMs?: number;
    /** Max bytes of the retained stderr diagnostic tail. */
    stderrMaxBytes?: number;
    /** Cooperative tool-call timeout budget (ms). */
    timeoutMs?: number;
}
export declare const Config: z<BetterGlobConfig>;
/** Resolved caps after schemastery defaulting — every field required. */
export interface BetterGlobCaps {
    excludeDirs: readonly string[];
    sampleOverCapGlobResults: boolean;
    maxResults: number;
    maxMetaBytes: number;
    rawOutputMaxBytes: number;
    graceMs: number;
    stderrMaxBytes: number;
    timeoutMs: number;
}
/**
 * Validate the schemastery-defaulted config into caps. Fails loud at load:
 * excludeDirs entries must be bare directory names (a separator or a blank
 * name would silently never match a directory in the traversal globs), caps
 * must be positive integers, and graceMs must fit a timer delay.
 * @param config - the schemastery-defaulted plugin config.
 * @returns the resolved caps.
 */
export declare function resolveConfig(config: BetterGlobConfig): BetterGlobCaps;
