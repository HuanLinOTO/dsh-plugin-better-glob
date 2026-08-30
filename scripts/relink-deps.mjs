/**
 * Relink peer-dep junctions to the BUILT dsh packages under
 * $DSH_HOME/source/current (default ~/.dsh/source/current), not the unbuilt
 * `../dsh` dev clone. The dev clone has no `lib/` output, so vitest (runtime)
 * and tsdown would both fail without these junctions; typecheck resolves the
 * same tree through tsconfig `paths`.
 *
 * Run by the pretest/prebuild scripts; safe to run repeatedly.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const BUILT = join(DSH_HOME, 'source', 'current')
const NODE_MODULES = resolve('node_modules')

const LINKS = {
  '@deepseek-ai/cordis': join(BUILT, 'vendor', 'cordis'),
  '@deepseek-ai/dsh-agent': join(BUILT, 'packages', 'core', 'agent'),
  '@deepseek-ai/dsh-llm': join(BUILT, 'packages', 'llm', 'llm'),
  '@deepseek-ai/dsh-scope': join(BUILT, 'packages', 'core', 'scope'),
  '@deepseek-ai/dsh-session': join(BUILT, 'packages', 'core', 'session'),
  '@deepseek-ai/dsh-system-prompt': join(BUILT, 'packages', 'core', 'system-prompt'),
  '@deepseek-ai/dsh-tool-fs-search': join(BUILT, 'packages', 'fs', 'tool-fs-search'),
  '@deepseek-ai/dsh-tools': join(BUILT, 'packages', 'core', 'tools'),
}

if (!existsSync(BUILT)) {
  console.error(`[relink-deps] built dsh not found at ${BUILT}`)
  console.error(`[relink-deps] run 'dsh' once to populate $DSH_HOME/source/current, then retry`)
  process.exit(1)
}

let changed = 0
for (const [name, target] of Object.entries(LINKS)) {
  const linkPath = join(NODE_MODULES, name)
  if (!existsSync(target)) {
    console.warn(`[relink-deps] SKIP ${name}: target not found at ${target}`)
    continue
  }
  rmSync(linkPath, { recursive: true, force: true })
  mkdirSync(join(linkPath, '..'), { recursive: true })
  symlinkSync(target, linkPath, 'junction')
  changed++
}

console.log(`[relink-deps] relinked ${changed} packages to ${BUILT}`)
