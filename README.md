<p align="center">
  <a href="https://dshfind.com/zh/plugins/huanlinoto/dsh-plugin-better-glob"><img src="https://dshfind.com/api/card/huanlinoto/dsh-plugin-better-glob?lang=zh" alt="dsh-plugin-better-glob card"></a>
</p>

# dsh-plugin-better-glob

以 **per-agent 阴影**顶替 DSH 内置 `glob` 工具：自动排除无底洞目录（`node_modules`、`dist`、`build`、`.venv` 等），模型要搜这些目录时必须显式传 `include` 白名单。`grep` 不受影响，不改任何内置插件注册面。

## 为什么是 per-agent 阴影

- 工具注册表按 scope 分层解析：**agent 自己层的注册遮蔽一切继承层**（headless 的全局层、web profile 里 preset 挂载的 standing scope 层）。
- 全局注册在 web profile 下会输给 preset 挂载；bundle patch 够不到 preset 文件。所以唯一全覆盖的机制是监听 `agent/session-start`，把同名工具经 `agent.ctx` 注册进 agent 自己的层 —— 同时注册同名 `tool:glob` 提示词 section（同 order）遮蔽内置文案。
- `startup`/`resume`/`clear`/`compact` 都会触发 session-start，WeakSet 保证幂等；插件配置热重载时对存活 agent 做dispose-再注册的 resync。

## 工具行为

- `pattern`（必填）/ `path`（可选）：与内置 glob 语义一致，mtime 排序、含隐藏与被 ignore 文件、100 条封顶 + spill 恢复。
- **`include`（可选，string[]）**：白名单。include 模式的路径段命中某排除目录名 → 该目录在本调用中被放行（argv 构造期摘掉它的否定 glob）；`include: ["**"]` 放行全部。include 永不过滤结果 —— `pattern` 才是匹配器。
- 排除的实现在 argv 构造期而非后置 glob：ripgrep 在遍历期 prune 掉被排除目录，后置 glob 救不回被剪的子树。
- VCS 目录（`.git/.svn/.hg/.bzr/.jj/.sl`）永远排除，不配置化。
- 执行底座复用内置 `@deepseek-ai/dsh-tool-fs-search` 的打包 ripgrep 二进制、subprocess 缝、错误词汇表与 spill 设施。

### 默认排除清单（`excludeDirs` 整体替换式）

`node_modules` `bower_components` `vendor` `Pods` `.yarn` `dist` `build` `out` `target` `obj` `.next` `.nuxt` `.output` `.svelte-kit` `.turbo` `.parcel-cache` `.cache` `coverage` `__pycache__` `.venv` `venv` `.tox` `.mypy_cache` `.pytest_cache` `.ruff_cache` `.gradle` `.terraform` `.idea`

### 配置

| 字段 | 默认 | 说明 |
|------|------|------|
| `excludeDirs` | 上表 | 排除目录名（裸名，不允许分隔符），整体替换默认清单 |
| `sampleOverCapGlobResults` | `false` | 超帽页是否按顶层条目抽样（同内置开关） |
| `globMaxResults` | `100` | 单次内联保留路径数，超出部分 spill |
| `globMetaMaxBytes` | `65536` | 卡片 meta 字节预算 |
| `rawOutputMaxBytes` | `20000000` | 单次解析的 rg stdout 上限 |
| `graceMs` / `stderrMaxBytes` / `timeoutMs` | `3000` / `65536` / `30000` | 同内置语义 |

## 开发

```sh
pnpm install            # pnpm-workspace.yaml 锚定本目录（防止向上并入 D:\Projects 的 workspace）
pnpm exec node scripts/relink-deps.mjs   # 把 @deepseek-ai/* junction 到 ~/.dsh/source/current 的已构建包（pretest/prebuild 自动跑）
pnpm run typecheck      # tsc --noEmit（类型经 tsconfig paths 解析 source/current 的 lib/types）
pnpm test               # vitest：argv/meta 纯逻辑 + 真实 ToolRuntime 组合 preflight
pnpm run build          # tsdown（lib/index.js）+ tsc（lib/types/*.d.ts）
```

peer 依赖（`@deepseek-ai/cordis`、`dsh-tools`、`dsh-tool-fs-search`、`dsh-system-prompt`、`dsh-agent`）由宿主提供，均为 optional peer；`schemastery` 是直接依赖。

## 运行

```sh
dsh plugin --profile web add "link:D:/Projects/deepseek-harness/dsh-plugin-better-glob"
# 之后重启 dsh web（由人类执行）+ 浏览器硬刷新
```

`link:` 引用下改源码后 `pnpm run build` 重建 `lib/` 即生效，无需重装。发布形态：GitHub `huanlinoto/dsh-plugin-better-glob`（预构建 `lib/` 入库，无 prepare）/ npm `@huanlin/dsh-plugin-better-glob`。

## 检查

- `pnpm run typecheck` — 严格模式类型门禁
- `pnpm test` — 40 用例：argv 构造（默认排除、include 按段提升、`**` 全提升、VCS 恒排除）、参数与配置校验、meta 投影/收窄、render 页脚；组合 preflight 用真实 `ToolRuntime` + `SystemPrompt` 验证阴影生效、全局视图不受污染、re-fire 幂等、reload resync
- `pnpm run build` — 产物 `lib/index.js`（peer 全 external）+ `lib/types/`

## 已知限制

- 插件停用后，已存活 agent 的阴影注册会保留到该 agent 销毁（注册挂在 agent scope 上，随其 unwind）。
- 配置热重载对「已在会话中的 agent」经 resync 生效；若加载器将来改为 cache-bust 重导入模块（同进程新模块实例），resync 会因 agent 层重名而失败报错（fail loud，不会静默失效）。
- `include` 的提升粒度是「目录名」，include 模式中目录名之后的子路径不影响遍历范围（`node_modules/a/**` 放行整个 `node_modules`）；精确到子目录的放行需缩小 `excludeDirs` 配置。
