/**
 * Pure argument handling for the better `glob` tool: model-argument
 * validation, include-whitelist lift computation, and ripgrep argv
 * construction. No I/O — every function here is testable without a host.
 * @module @huanlin/dsh-plugin-better-glob/argv
 */
/**
 * Directory names the tool never descends into, regardless of the
 * `excludeDirs` configuration: VCS metadata stores (the built-in tool's
 * fixed exclusion set).
 */
export declare const VCS_EXCLUDES: readonly string[];
/**
 * Default bottomless directories excluded from every search: dependency
 * installs, build outputs, framework state, caches, and virtualenvs that
 * routinely hold hundreds of thousands of files. The `excludeDirs` config
 * replaces this list wholesale.
 */
export declare const DEFAULT_EXCLUDE_DIRS: readonly string[];
/** Validated `glob` arguments after value-constraint checks. */
export interface GlobInput {
    pattern: string;
    path?: string;
    include?: string[];
}
/**
 * Validate the value constraints the schema DSL cannot express: a non-blank
 * `pattern`, a non-blank `path` when given, and non-blank `include` entries
 * when given. Throws a plain `Error` (an ordinary tool argument error)
 * otherwise.
 * @param args - the schema-validated `glob` arguments.
 * @returns the accepted input, unchanged.
 */
export declare function parseGlobArgs(args: {
    pattern: string;
    path?: string;
    include?: string[];
}): GlobInput;
/**
 * The excluded directory names the include whitelist lifts back into one
 * call's search. A name lifts when an include pattern carries it as a path
 * segment (`node_modules/**` + `/package.json` lifts `node_modules`); a
 * pattern of only wildcard segments (`**`) lifts every candidate. Segments
 * that name no configured exclusion are ignored.
 *
 * The lift happens at argv construction time, not as a later ripgrep glob:
 * ripgrep prunes an excluded directory during traversal, so a glob emitted
 * after the exclusion could never re-enter the pruned subtree.
 * @param include - the call's include whitelist, when the model passed one.
 * @param excludeDirs - the configured exclusion names.
 * @returns the subset of `excludeDirs` the whitelist lifts.
 */
export declare function liftedExcludeNames(include: readonly string[] | undefined, excludeDirs: readonly string[]): ReadonlySet<string>;
/**
 * Build the fixed `rg --files` argv for one better-`glob` call. Every
 * model-controlled value is a plain argv element — no shell layer exists, so
 * no quoting applies; the search root rides behind `--` so a leading-dash
 * path can never parse as a flag. `--sort=modified` orders by modification
 * time and `--no-ignore --hidden` searches ignored and hidden files, matching
 * the built-in tool's contract. Each excluded name carries TWO negated globs
 * (the bare form prunes the directory during traversal; the contents form
 * still excludes the internals when the search root sits at or inside the
 * directory). VCS excludes are unconditional; a lifted name omits both of
 * its globs, which is what lets ripgrep descend into it again.
 * @param input - the validated arguments.
 * @param excludeDirs - the configured exclusion names.
 * @returns the complete ripgrep argument vector (excluding the binary itself).
 */
export declare function buildGlobArgv(input: GlobInput, excludeDirs: readonly string[]): string[];
