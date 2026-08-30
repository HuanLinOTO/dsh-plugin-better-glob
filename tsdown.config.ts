/** Build the host bundle. Peer `@deepseek-ai/*` imports stay external (the host provides them); schemastery bundles in. */
import { defineConfig, type UserConfig } from 'tsdown'

const ID = '@huanlin/dsh-plugin-better-glob'

const HOST_EXTERNALS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tools',
]

const libConfig: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  external: HOST_EXTERNALS,
}

export default defineConfig([libConfig])
