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
  悬停时主图标切换成"展开"图标（ZCode 同款）。
- **七个分区**（顺序对齐 ZCode）：`更改`(git) → `目标` → `计划` → `进程` → `后台` → `工作流` → `智能体`。
  **没有内容的分区不渲染**，也不显示空状态文案。
  `后台` / `工作流` / `智能体` **默认收起**（ZCode 行为），标题栏的尾随计数让你不展开也知道数量。
- **展开策略菜单**：面板标题栏的 `⋯` 提供三态——自动（默认，每次打开为收起态）/ 始终展开 / 始终收起，选择持久化到 localStorage。（ZCode 只发了一个「自动展开」项，这里把它原本设计的三态补全。）
- **后台/工作流行**：点击就地展开实时输出；运行中的行带**停止按钮**（`ctx.jobs.kill`，ZCode 的 `RunningWorkCancelButton`）。
- **目标行**：暂停 / 继续 / **清除**按钮（`ctx.remote.goals`，与 ui-goal 同一命名空间）。
- **智能体行**：点击在右侧栏打开该子会话的会话页签。
- **进程折叠窗口**：待办 ≤ 6 项全显；> 6 项只显示以当前项为中心的 3 项，前后折成
  **四种**计数按钮（已完成 / 前面 / 待处理 / 后面 N 项），点击就地展开，悬停弹预览卡。
- **跟随主题与字号**：只用 `--dsw-*` 主题令牌与宿主的排版轴变量，深浅色与字号设置都跟着走。
- **中英双语**：文案走 DSH 的 Client locale 服务。
- **不崩掉整块面板**：内部错误边界——任何分区渲染异常只在该分区显示一行错误，
  绝不会让槽位条目被框架摘除（条目一被摘除，本插件遮蔽的宿主 todo dock 会顶回来）。

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
| 面板标题栏的 `⋯` | 展开策略：自动 / 始终展开 / 始终收起 |
| 面板标题栏的收起按钮 | 回到胶囊 |
| 分区标题 | 折叠 / 展开该分区 |
| 后台 / 工作流行 | 点击展开实时输出；运行中的行额外有「停止」 |
| 后台 / 工作流行 | 展开 / 收起该任务的实时输出（无输出且非运行中的行不可点） |
| 进程折叠行 | 点击就地展开该组；悬停弹预览卡 |
| 目标分区 | 暂停 / 继续 / 清除目标 |
| 更改分区 | 刷新按钮重新读取 git 状态 |
| 智能体行 | 在右侧栏打开该子会话页签 |

默认（「自动」）下：展开 / 收起与分区折叠是组件内局部状态，刷新后回到收起态；
选「始终展开 / 始终收起」时该选择会持久化。

## 数据来源

面板不自己推导状态，只读 DSH 已有的投影与服务：

| 分区 | 来源 | 形状 |
|---|---|---|
| 更改 | **本包宿主半区**的只读路由 `GET /dsh-session-status-panel/git?sessionId=…` | `{ isRepository, branch, ahead, behind, dirtyCount, added, removed }` |
| 目标 | `useProjection('goal')` + 动作走 `ctx.remote.goals` | 嵌套：`{ goal: { objective, phase, maxGoalRounds, blockedReason? }, roundsStarted, createdAt, updatedAt }`；`phase` 为 `active \| paused \| blocked \| complete`；动作 `pause/resume/clear(sessionId, ref)` |
| 计划 | `useProjection('plan')` | `{ active, pending? }`——只有 plan-mode 开合，DSH 没有 ZCode 那种 ExitPlanMode 记录投影 |
| 进程 | `useProjection('todos')` | `TodoItem[] \| null`，`{ content, status: pending \| in_progress \| completed }` |
| 后台 / 工作流 | 客户端 `jobs` 服务（按 `kind` 拆分） | `state.getSnapshot()` / `watchRows(sessionId)` / `observe(sessionId, id)` / `kill(sessionId, id)`；`JobView = { id, kind, label, status, progress?, startedAt, finishedAt?, output }` |
| 智能体 | `useProjection('subagentCatalog')` | `{ id, createdAt, mode: one-shot \| continuable \| unknown, label? }`——**只有身份，没有运行状态**，所以面板不显示状态 |

## 宿主半区（更改分区的数据来源）

客户端拿不到 git 数据，所以 `index.js` 注册一个**只读**路由：

`GET /dsh-session-status-panel/git?sessionId=<id>` →
用 `ctx.shell` 在该会话的工作目录跑
`git status --porcelain=v2 --branch; echo <标记>; git diff HEAD --numstat`，
解析成 `{ isRepository, branch, ahead, behind, dirtyCount, added, removed }`。

安全（与 `dsh-whale-widget` 同一套做法）：

- 只接受 `GET`；非 git 仓库如实返回 `isRepository: false`，不猜；
- 自带 **回环 Host / 同源 Origin / `sec-fetch-site`** 校验，任何解析异常一律拒绝（fail-closed）；
- 命令是只读的（`status` / `diff`），带 5s 超时与 256 KiB stdout 上限；
- 客户端在**展开面板时**才懒加载，收起态不打这个路由。

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
- **可选注入**：`locale` / `jobs` / `sidebarRight` / `remote.goals` 都通过 `ctx.inject([...])` 取得；
  任一服务缺失时只是对应能力降级（少分区 / 按钮禁用 / 回退中文），不会让面板整体不激活。

## 已知限制

- **`计划` 分区比 ZCode 薄**：DSH 只有 plan-mode 的开合投影（`{active, pending}`），
  没有 ZCode 那种 ExitPlanMode 记录列表，所以点不进"计划详情"。
- **`智能体` 分区不含运行状态**：`subagentCatalog` 只承载身份（label/mode）。
  子代理的运行状态与停止在 `后台` 分区里以 `kind=subagent` 的 job 行呈现——
  两者不做启发式关联（按 label 匹配不可靠），宁可不猜。
- **没有"已结束目录"入口**：ZCode 的终端/工作流/智能体分区页脚各有"已结束 N"的目录页签入口，
  DSH 侧没有对应的目录页签可开。
- **折叠预览卡是自绘的**：ZCode 用 Radix HoverCard（portal + 定位），这里用 `position: fixed`
  自绘（面板 `overflow: hidden` 会裁掉 absolute 子元素），没有 portal。
- 面板位置固定右上角，不可拖拽；`更改` 分区需要**宿主半区**（老版本只装客户端那半会显示读取失败）。
- 胶囊优先级链比 ZCode 少三支：git 更改、计划计数、已结束工作流（对应数据 DSH 侧缺失或未接）。
- 图标是内联 SVG（未照抄宿主 `ui-primitives` 的 path，笔画略有差异）。

## 许可与归属

MIT（见 [`LICENSE`](LICENSE)）。版式与交互派生自 **ZCode**（Apache-2.0），详见 [`NOTICE.md`](NOTICE.md)。
