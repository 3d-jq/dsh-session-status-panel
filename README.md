# dsh-session-status-panel

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 **Web 会话状态面板**插件。
仿 ZCode 控制台的状态面板版式：**收起时是一行胶囊，展开后是分区的会话状态卡片**。

```
┌──────────────────────────────────────────┐
│ ▸ ⊙ 目标                       12 秒 · 已完成 │
│   显示测试用目标：验证「目标」分区…            │
│ #0  第 0 / 1 轮                           │
├──────────────────────────────────────────┤
│ ▾ ▤ 进程                            5 / 7 │
│   前面 4 项                                │
│   ✓ 已完成的一条（删除线）                   │
│   → 当前进行中的一条                        │
│   ○ 待处理的一条                           │
├──────────────────────────────────────────┤
│ ▾ ▣ 后台                          1 运行中 │
│   ● Start-Sleep -Seconds 300 …           │
│     pwsh  运行中  3 分 17 秒               │
│     ┌ 展开后的实时输出 ─────────────┐        │
├──────────────────────────────────────────┤
│ ▾ ⌷ 智能体                              3 │
│   ⊞ Research DSH plugin contract  可续聊 › │
└──────────────────────────────────────────┘
```

## 特性

- **收起态胶囊**：按固定优先级取第一个可用项作摘要——
  当前待办 → 未完成目标 → 已完成目标 → 最近完成的待办 → 后台运行数。
- **四个分区**：`目标`（goal 投影）、`进程`（todos 投影）、`后台`（客户端 jobs 服务）、
  `智能体`（subagentCatalog 投影）。**没有内容的分区不渲染**，也不显示空状态文案。
- **后台可点开**：点击后台任务行就地展开该任务的实时输出（跟随流式更新、标注截断）。
- **智能体可点开**：点击子代理行在右侧栏打开该子会话的会话页签。
- **进程折叠窗口**：待办 ≤ 6 项全显；> 6 项只显示以当前项为中心的 3 项，前后折成计数按钮，点击就地展开。
- **跟随主题与字号**：只用 `--dsw-*` 主题令牌与宿主的排版轴变量，深浅色与字号设置都跟着走。
- **中英双语**：文案走 DSH 的 Client locale 服务。

## 安装

桌面端/Web 端的会话里直接说一句即可（走内置的 `plugin_manager`，它作用于当前 profile）：

> 帮我装上 dsh-session-status-panel

等价的命令行方式：

```sh
# 从 GitHub 安装（推荐，尚未发布到 npm 时用这条）
dsh plugin --profile <profile> add github:3d-jq/dsh-session-status-panel

# 从 npm 安装（发布之后）
dsh plugin --profile <profile> add dsh-session-status-panel

# 本地开发（软链到源码目录）
dsh plugin --profile <profile> add link:/绝对路径/dsh-session-status-panel
```

装好后刷新页面即可看到右上角的胶囊。**没有内容时面板整体不渲染**（新建的空会话就是这样）。

## 交互

| 元素 | 行为 |
|---|---|
| 胶囊 | 点击展开为面板 |
| 面板标题栏的收起按钮 | 回到胶囊 |
| 分区标题 | 折叠 / 展开该分区 |
| 后台任务行 | 展开 / 收起该任务的实时输出（无输出且非运行中的行不可点） |
| 智能体行 | 在右侧栏打开该子会话页签 |

展开 / 收起与分区折叠都是组件内局部状态，**不持久化**：刷新后回到胶囊态。

## 数据来源

面板不自己推导状态，只读 DSH 已有的投影与服务：

| 分区 | 来源 | 形状 |
|---|---|---|
| 进程 | `useProjection('todos')` | `TodoItem[] \| null`，`{ content, status: pending \| in_progress \| completed }` |
| 目标 | `useProjection('goal')` | 嵌套：`{ goal: { objective, phase, maxGoalRounds, blockedReason? }, roundsStarted, createdAt, updatedAt }`；`phase` 为 `active \| paused \| blocked \| complete` |
| 后台 | 客户端 `jobs` 服务 | `state.getSnapshot()` / `watchRows(sessionId)` / `observe(sessionId, id)`；`JobView = { id, kind, label, status, progress?, startedAt, finishedAt?, output }` |
| 智能体 | `useProjection('subagentCatalog')` | `{ id, createdAt, mode: one-shot \| continuable \| unknown, label? }`——**只有身份，没有运行状态**，所以面板不显示状态 |

## 实现约定

- **座位**：注册进 `conversation.input.dock`（session 作用域，只有它的 slot props 带
  `useProjection` / `sessionId`）；视觉定位由组件自己用 `position: fixed` 锚到视口右上角，
  这正是宿主 `ContextMeter` 展开面板用的做法。顶部偏移由 `--dsh-frame-top-clearance`（macOS 条带）
  与 `--dsh-windows-titlebar-height`（Windows 标题栏）推导，层本身 `pointer-events: none`。
- **接管宿主自带的 todo dock**：注册时复用该 cell 的 id（`todo`）并给更低的 `priority: -1`。
  ui-slots 的 cell 规则是"同 id 只在完全相同的 priority 上冲突并抛错，priority 更低者遮蔽渲染"
  （`ui-slots/src/index.ts:1211` / `:1341`），因此本插件顶掉 `ui-conversation` 的 todo dock，
  避免同屏出现两个进度显示；插件被禁用或卸载时宿主那个自动回来。
  宿主 `ui-goal` 的目标条**不遮蔽**——它带暂停/继续/清除等控制，而本面板只读展示目标。
- **样式**：抬升表面一律 `border: 0` + `--dsw-elevation-*` 阴影（不得与 `--dsw-alias-border-*` 并置，
  见 DSH `docs/web-styling.md`）；排版走 `--dsh-content-font-size(-secondary)` 与其 `-delta` 行高；
  状态点沿用宿主 `StateDot` 语汇（实心 / 空心环 / 失败带 30% 同色外环）。
- **不依赖 Harness Client 包**：浏览器半区为纯 JavaScript（无 JSX、无 import），图标是自带内联 SVG。
- **可选注入**：`locale` / `jobs` / `sidebarRight` 都通过 `ctx.inject([...])` 取得；
  任一服务缺失时只是对应能力降级（少分区 / 不可点 / 回退中文），不会让面板整体不激活。

## 已知限制

- **没有 Git 分区**：DSH 客户端没有 git 投影，也没有 git 服务；`workspaceChanges` 是"本会话文件改动"
  而非 git 状态。要做需在本包里加宿主半区（跑 `git status`）并把结果送到客户端。
- 后台行只有「查看输出」，没有「停止」按钮（`ctx.jobs.kill` 已可用，未接 UI）。
- 折叠行没有悬浮预览卡；面板位置固定右上角，不可拖拽。
- 展开 / 收起状态不持久化。

## 许可与归属

MIT（见 [`LICENSE`](LICENSE)）。版式与交互派生自 **ZCode**（Apache-2.0），详见 [`NOTICE.md`](NOTICE.md)。
