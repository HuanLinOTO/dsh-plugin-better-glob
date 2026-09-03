import z from "schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { runRipgrep, sampleAcrossTopLevel, toWorkdirRelative, trySaveFormattedResult } from "@deepseek-ai/dsh-tool-fs-search";
//#region src/argv.ts
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
const VCS_EXCLUDES = [
	".git",
	".svn",
	".hg",
	".bzr",
	".jj",
	".sl"
];
/**
* Default bottomless directories excluded from every search: dependency
* installs, build outputs, framework state, caches, and virtualenvs that
* routinely hold hundreds of thousands of files. The `excludeDirs` config
* replaces this list wholesale.
*/
const DEFAULT_EXCLUDE_DIRS = [
	"node_modules",
	"bower_components",
	"vendor",
	"Pods",
	".yarn",
	"dist",
	"build",
	"out",
	"target",
	"obj",
	".next",
	".nuxt",
	".output",
	".svelte-kit",
	".turbo",
	".parcel-cache",
	".cache",
	"coverage",
	"__pycache__",
	".venv",
	"venv",
	".tox",
	".mypy_cache",
	".pytest_cache",
	".ruff_cache",
	".gradle",
	".terraform",
	".idea"
];
/**
* Validate the value constraints the schema DSL cannot express: a non-blank
* `pattern`, a non-blank `path` when given, and non-blank `include` entries
* when given. Throws a plain `Error` (an ordinary tool argument error)
* otherwise.
* @param args - the schema-validated `glob` arguments.
* @returns the accepted input, unchanged.
*/
function parseGlobArgs(args) {
	if (args.pattern.trim().length === 0) throw new Error("pattern must be a non-empty string");
	if (args.path !== void 0 && args.path.trim().length === 0) throw new Error("path must be a non-empty string when given");
	if (args.include !== void 0) {
		for (const entry of args.include) if (entry.trim().length === 0) throw new Error("include entries must be non-empty strings");
	}
	return {
		pattern: args.pattern,
		...args.path !== void 0 ? { path: args.path } : {},
		...args.include !== void 0 ? { include: args.include } : {}
	};
}
/** Whether one include pattern names no concrete directory (every segment is a wildcard or empty), lifting every excluded directory. */
function liftsEveryDirectory(pattern) {
	return pattern.split("/").every((segment) => segment === "**" || segment === "*" || segment.length === 0);
}
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
function liftedExcludeNames(include, excludeDirs) {
	if (include === void 0) return /* @__PURE__ */ new Set();
	const candidates = /* @__PURE__ */ new Set();
	for (const pattern of include) {
		if (liftsEveryDirectory(pattern)) {
			for (const name of excludeDirs) candidates.add(name);
			continue;
		}
		for (const segment of pattern.split("/")) {
			if (segment === "**" || segment === "*" || segment.length === 0) continue;
			candidates.add(segment);
		}
	}
	const lifted = /* @__PURE__ */ new Set();
	for (const name of excludeDirs) if (candidates.has(name)) lifted.add(name);
	return lifted;
}
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
function buildGlobArgv(input, excludeDirs) {
	const lifted = liftedExcludeNames(input.include, excludeDirs);
	const parts = [
		"--files",
		`--glob=${input.pattern}`,
		"--sort=modified",
		"--no-ignore",
		"--hidden"
	];
	const pushExclusion = (name) => {
		parts.push(`--glob=!**/${name}`, `--glob=!**/${name}/**`);
	};
	for (const name of VCS_EXCLUDES) pushExclusion(name);
	for (const name of excludeDirs) if (!lifted.has(name)) pushExclusion(name);
	if (input.path !== void 0) parts.push("--", input.path);
	return parts;
}
//#endregion
//#region src/caps.ts
/**
* Plugin configuration: the Schemastery schema, the resolved caps, and the
* load-time validation. Every field defaults, so a patch insert row without
* a `config` block boots.
* @module @huanlin/dsh-plugin-better-glob/caps
*/
const Config = z.object({
	excludeDirs: z.array(z.string()).default([...DEFAULT_EXCLUDE_DIRS]).description("Bottomless directory names excluded from every glob search. Replaces the default list wholesale; VCS directories (.git etc.) are always excluded on top. include lifts a name back into one call."),
	sampleOverCapGlobResults: z.boolean().default(false).description("Whether an over-cap glob page is sampled across top-level entries instead of taking the modification-time head."),
	globMaxResults: z.number().default(100).description("Max paths one glob call retains inline; the complete list spills to a file past it."),
	globMetaMaxBytes: z.number().default(65536).description("Max bytes of one glob result's serialized presentationMeta; trailing paths drop past it."),
	rawOutputMaxBytes: z.number().default(2e7).description("Max complete raw rg stdout one call parses."),
	graceMs: z.number().default(3e3).description("Terminate-escalation grace period (ms) for the search process."),
	stderrMaxBytes: z.number().default(65536).description("Max bytes of the retained stderr diagnostic tail."),
	timeoutMs: z.number().default(3e4).description("Cooperative tool-call timeout budget (ms).")
});
/** The `@deepseek-ai/dsh-timeout` MAX_TIMER_DELAY_MS (2^31-1), inlined to keep the peer set minimal. */
const MAX_GRACE_MS = 2147483647;
/** Every cap counts items/bytes/milliseconds — a positive integer, or retention and timeout arithmetic misbehaves silently. */
function assertPositiveInteger(name, value) {
	if (!Number.isInteger(value) || value < 1) throw new Error(`better-glob: ${name} must be a positive integer`);
}
/**
* Validate the schemastery-defaulted config into caps. Fails loud at load:
* excludeDirs entries must be bare directory names (a separator or a blank
* name would silently never match a directory in the traversal globs), caps
* must be positive integers, and graceMs must fit a timer delay.
* @param config - the schemastery-defaulted plugin config.
* @returns the resolved caps.
*/
function resolveConfig(config) {
	const excludeDirs = config.excludeDirs ?? [...DEFAULT_EXCLUDE_DIRS];
	for (const name of excludeDirs) if (name.length === 0 || name.includes("/") || name.includes("\\")) throw new Error(`better-glob: excludeDirs entries must be bare directory names without path separators, got ${JSON.stringify(name)}`);
	const maxResults = config.globMaxResults ?? 100;
	const maxMetaBytes = config.globMetaMaxBytes ?? 65536;
	const rawOutputMaxBytes = config.rawOutputMaxBytes ?? 2e7;
	const graceMs = config.graceMs ?? 3e3;
	const stderrMaxBytes = config.stderrMaxBytes ?? 65536;
	const timeoutMs = config.timeoutMs ?? 3e4;
	assertPositiveInteger("globMaxResults", maxResults);
	assertPositiveInteger("globMetaMaxBytes", maxMetaBytes);
	assertPositiveInteger("rawOutputMaxBytes", rawOutputMaxBytes);
	assertPositiveInteger("graceMs", graceMs);
	if (graceMs > MAX_GRACE_MS) throw new Error(`better-glob: graceMs must be no greater than ${MAX_GRACE_MS}`);
	assertPositiveInteger("stderrMaxBytes", stderrMaxBytes);
	assertPositiveInteger("timeoutMs", timeoutMs);
	return {
		excludeDirs,
		sampleOverCapGlobResults: config.sampleOverCapGlobResults ?? false,
		maxResults,
		maxMetaBytes,
		rawOutputMaxBytes,
		graceMs,
		stderrMaxBytes,
		timeoutMs
	};
}
//#endregion
//#region src/tool.ts
/** The serialized UTF-8 byte size of one meta payload (the size persisted and re-sent). */
function metaBytes(meta) {
	return Buffer.byteLength(JSON.stringify(meta), "utf8");
}
/**
* Drop trailing paths until the serialized meta fits `maxMetaBytes`, marking
* the result `truncated` when anything was dropped. `total` is preserved. A
* single path too large to fit on its own is kept: the invariant is a bounded
* payload wherever droppable, never an empty card that hides a real result.
*/
function capMetaBytes(meta, maxMetaBytes) {
	if (metaBytes(meta) <= maxMetaBytes) return meta;
	const paths = [...meta.paths];
	while (paths.length > 1 && metaBytes({
		...meta,
		paths,
		truncated: true
	}) > maxMetaBytes) paths.pop();
	return {
		...meta,
		paths,
		truncated: true
	};
}
/** Project one canonical value into the bounded `presentationMeta` the search card renders. */
function pathsMeta(value, maxMetaBytes) {
	return capMetaBytes({
		shape: "paths",
		paths: value.paths,
		truncated: value.truncated,
		total: value.total
	}, maxMetaBytes);
}
/**
* Narrow opaque live or replayed result metadata to a {@link SearchResultView}.
* Malformed metadata returns `undefined` so `presentResult` falls back to the
* generic card instead of throwing during replay of an older or hand-edited
* log. A zero-result meta narrows to a valid empty card.
* @param meta - result metadata (the {@link PathsSearchMeta} the tool projected).
* @returns the search view, or `undefined` for absent or malformed metadata.
*/
function pathsViewFromMeta(meta) {
	if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return void 0;
	const record = meta;
	const { truncated, total } = record;
	if (typeof truncated !== "boolean" || typeof total !== "number") return void 0;
	if (record.shape !== "paths") return void 0;
	const { paths } = record;
	if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) return void 0;
	return {
		card: "search",
		shape: "paths",
		paths,
		truncated,
		total
	};
}
/** Format one canonical value for the Native surface: the page, plus the cap basis and recovery path when capped. */
function renderGlobValue(value) {
	if (value.paths.length === 0) return "No files found";
	const body = value.paths.join("\n");
	if (!value.truncated) return body;
	const basis = value.sampled ? ", sampled across top-level entries instead of taken in modification-time order" : ", the modification-time-ordered head";
	const recovery = value.spill !== void 0 ? `Full sorted result stored at: ${value.spill.locator}. ${value.spill.hint}` : "The complete result could not be saved; narrow pattern or path to see more.";
	return `${body}\n\n(Showing ${value.paths.length} of ${value.total} paths${basis}. ${recovery})`;
}
/**
* Build the better `glob` tool definition.
* @param ctx - the plugin context; execution reads its `subprocess` service and opportunistic `spillStore`.
* @param caps - the deployment's resolved caps (plugin config after defaulting).
* @returns the registry-ready definition; the caller registers it into agent scopes.
*/
function defineBetterGlobTool(ctx, caps) {
	const overCapDescription = caps.sampleOverCapGlobResults ? `a larger result instead returns ${caps.maxResults} paths sampled across top-level entries` : `a larger result returns the first ${caps.maxResults} paths in modification-time order`;
	const excludedNote = caps.excludeDirs.length > 0 ? `Bottomless directories are excluded automatically (${caps.excludeDirs.join(", ")}); pass include to search inside one.` : "No directories are excluded by configuration.";
	return defineTool({
		name: "glob",
		description: `Find files whose paths match a glob pattern. Returns matching file paths — never directories — in modification-time order, including hidden and ignored files (VCS metadata directories are always excluded). Up to ${caps.maxResults} paths come back inline; ${overCapDescription}, says so, and reports where the complete sorted list was saved. This tool does not enumerate directory entries. ` + excludedNote,
		parameters: {
			pattern: {
				type: "string",
				required: true,
				description: "Glob pattern to match file paths against (e.g. \"**/*.ts\", \"src/**/*.test.js\"). A pattern with no \"/\" matches the basename at any depth, so \"*\" and \"*.ts\" both search the whole tree; include a separator to anchor the depth."
			},
			path: {
				type: "string",
				description: "Directory to search in. Defaults to the session workspace; a relative path resolves against it."
			},
			include: {
				type: "array",
				items: { type: "string" },
				description: "Whitelist that lifts excluded directories back into THIS search: an include pattern naming an excluded directory as a path segment (e.g. \"node_modules/**/package.json\") removes that directory from the exclusion set; a bare wildcard pattern (\"**\") lifts every excluded directory. include never filters results — pattern does. Omit it for ordinary searches."
			}
		},
		timeoutMs: caps.timeoutMs,
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					root: {
						type: "string",
						required: true
					},
					paths: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					total: {
						type: "integer",
						required: true
					},
					truncated: {
						type: "boolean",
						required: true
					},
					sampled: {
						type: "boolean",
						required: true
					},
					spill: {
						type: "object",
						additionalProperties: false,
						properties: {
							locator: {
								type: "string",
								required: true
							},
							hint: {
								type: "string",
								required: true
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderGlobValue(value)
			}],
			presentationMeta: (_args, value) => pathsMeta(value, caps.maxMetaBytes)
		},
		async execute(args, exec) {
			const input = parseGlobArgs(args);
			const run = await runRipgrep(ctx, exec, "glob", buildGlobArgv(input, caps.excludeDirs), caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes);
			const root = input.path === void 0 ? "." : toWorkdirRelative(input.path, run.workdir);
			const all = [];
			if (!run.noMatches) for (const line of run.stdout.split("\n")) {
				if (line.length === 0) continue;
				all.push(toWorkdirRelative(line, run.workdir));
			}
			if (all.length <= caps.maxResults) return {
				root,
				paths: all,
				total: all.length,
				truncated: false,
				sampled: false
			};
			const page = caps.sampleOverCapGlobResults ? sampleAcrossTopLevel(all, caps.maxResults, root).items : all.slice(0, caps.maxResults);
			const spillRef = await trySaveFormattedResult(ctx, exec, "glob-results.txt", all.join("\n"));
			return {
				root,
				paths: page,
				total: all.length,
				truncated: true,
				sampled: caps.sampleOverCapGlobResults,
				...spillRef !== void 0 ? { spill: {
					locator: spillRef.locator,
					hint: spillRef.retrievalHint
				} } : {}
			};
		},
		presentCall: (args) => {
			const where = args.path !== void 0 ? ` in ${args.path}` : "";
			return {
				card: "generic",
				title: `Glob ${args.pattern}${where}`,
				kind: "search",
				rawInput: args.pattern
			};
		},
		presentResult: (_args, result) => {
			if (result.isError) return void 0;
			return pathsViewFromMeta(result.meta);
		}
	});
}
//#endregion
//#region src/index.ts
/** Cordis plugin name used by loader diagnostics. */
const name = "better-glob";
/**
* Services required by the plugin: `tools`/`systemPrompt` register the
* shadow into agent scopes, `subprocess` executes ripgrep, `agents` lists
* live agents for the reload resync.
*/
const inject = [
	"tools",
	"systemPrompt",
	"subprocess",
	"agents"
];
/**
* The prompt section the shadow registers per agent. Same name and order as
* the built-in `tool:glob` section, so the agent-layer registration shadows
* the built-in text; the section text names the configured exclusions and
* the include whitelist escape hatch.
* @param caps - the deployment's resolved caps.
* @param order - the section order for `tool:glob` (resolve via
*   `ctx.systemPrompt.getSectionOrder('TOOL_GLOB')` so the shadow stays
*   aligned with the built-in registration).
* @returns the section to register through `agent.ctx.systemPrompt`.
*/
function shadowSection(caps, order) {
	return {
		name: "tool:glob",
		order,
		text: "Use the glob tool — not shell find — to discover files by path pattern. A pattern with no \"/\" matches basenames at any depth, so \"*\" matches every file in the tree rather than its top level. Results are files only, never directories, and include hidden and ignored files. " + (caps.excludeDirs.length > 0 ? `Bottomless directories (${caps.excludeDirs.join(", ")}) are excluded automatically — pass include (for example ["node_modules/**"]) when a search must look inside one.` : "No directories are excluded by configuration.") + " A result that fits comes back in modification-time order."
	};
}
/** Register the shadow into one agent's own layer; returns the combined disposer for reload resync. */
function shadowAgent(agent, tool, section) {
	const disposeTool = agent.ctx.tools.register(tool);
	const disposeSection = agent.ctx.systemPrompt.section(section);
	return () => {
		disposeTool();
		disposeSection();
	};
}
/**
* Per-agent shadow registrations, module-level so a config reload (the same
* module instance re-running `apply`) can dispose the previous fiber's
* registration before re-registering with the fresh config.
*/
const shadowed = /* @__PURE__ */ new WeakMap();
/**
* Register the better-`glob` shadow: a `agent/session-start` listener that
* mounts the tool and prompt section into every agent's own layer, plus a
* resync over already-live agents so a config reload takes effect without a
* restart.
* @param ctx - the plugin context; registrations are effects scoped to it.
* @param config - the (schemastery-defaulted) plugin configuration.
*/
function apply(ctx, config) {
	const caps = resolveConfig(config);
	const tool = defineBetterGlobTool(ctx, caps);
	const section = shadowSection(caps, ctx.systemPrompt.getSectionOrder("TOOL_GLOB"));
	const shadow = (agent) => {
		if (shadowed.has(agent)) return;
		shadowed.set(agent, shadowAgent(agent, tool, section));
	};
	ctx.on("agent/session-start", ({ agent }) => {
		shadow(agent);
	});
	for (const agent of ctx.agents.list()) {
		shadowed.get(agent)?.();
		shadowed.delete(agent);
		shadow(agent);
	}
}
//#endregion
export { Config, DEFAULT_EXCLUDE_DIRS, VCS_EXCLUDES, apply, buildGlobArgv, defineBetterGlobTool, inject, liftedExcludeNames, name, parseGlobArgs, pathsMeta, pathsViewFromMeta, renderGlobValue, resolveConfig, shadowSection };
