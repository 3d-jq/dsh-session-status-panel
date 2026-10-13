# NOTICE / 归属声明

## 第三方来源

本插件包含 **ZCode**（<https://github.com/zai-org/ZCode>，Apache License 2.0）的移植代码。
按 Apache-2.0 的要求在此声明来源：

### 1:1 移植的模块（逐字搬运，只改类型标注）

| 本包文件 | 上游源文件 |
|---|---|
| `zcode-model.js`（由 `scripts/build-client.mjs` 内联进 `client.js` 的 `__ZCODE_MODEL_*` 标记之间） | `packages/ui/src/v4/conversationStatusPanelModel.ts`（385 行）<br>`packages/ui/src/v4/conversationLayout.ts` |
| `scripts/zcode-model-check.mjs`（上述模块的单元测试，25 条） | —（本包自写） |

移植时**唯一的改动**是把 TypeScript 类型标注换成 JS（去类型、`?.` / `??` 展开为等值的显式判断），
并在文件头注明数据入口适配。函数体、分支顺序、注释要旨保持原样。

移植过程中确认的三条上游语义（**勿回退**，都有上游出处）：

- `workflowRunStepCounts` 判「已结算」用 `node.phase === 'settled'`，**不是** `node.status`
  （上游 `packages/shared/src/zcode-protocol-v4/workflow-runs-caps.ts:120`）。按 status 判会让步数虚高
  ——这正是移植首轮被单元测试抓到的一处实现错误。
- `buildGitModel` 在 `added + removed <= 0` 时返回 `null`：干净仓库不挂 Git 分区。
- workflow 降级行（work 有、run 无）只收 `running` 且追加在末尾；`cancellable` 只在 work 仍 `running`
  时给出（已结束的 work 不给 Stop，否则就是一个点了没反应的按钮）。

### 本包自己的适配层（不是移植）

- `client.js` 里的 `adaptToZCodeInput` / `jobToZCodeWork` / `goalToZCodeGoal`：把 DSH 的会话投影
  （`todos` / `goal` / `subagentCatalog`）与客户端 `jobs` 服务喂给 ZCode 原版模型函数。
  只做**形状对齐**（词表映射、字段搬运），不做任何显示规则判断。
- 表现层（内联样式、自绘浮层、图标 SVG）：**不是** ZCode 代码的搬运。ZCode 全仓零个 `*.module.css`，
  样式 100% 是 Tailwind v4 工具类；而 DSH 插件规范明文禁止 Tailwind 与组件库
  （`dsh/docs/web-styling.md`：`Use CSS Modules and clsx; do not add a component library or Tailwind.`），
  照抄类名会大面积失效且违规。因此这部分按
  `cordis-plugin-development/references/practices.md` 的要求，用内联样式逐条还原 ZCode 对应的视觉与交互，
  颜色只引用 `--dsw-*` 主题令牌。
- 面板座位（`conversation.input.dock` + `position: fixed` 定位）、错误边界、
  `scripts/render-probe.mjs` / `scripts/geometry-check.mjs` / `scripts/check-identifiers.mjs`：本包自写。

### 已知无法 1:1 的两点

- **Radix Portal**：ZCode 的浮层（HoverCard / DropdownMenu）靠 Portal 逃出 `backdrop-filter` 包含块；
  插件半区只有 `require('react')`，没有 `react-dom`，无法 portal。本包改为
  `position: absolute` + 面板空间坐标换算（`clampTop` / `clampRightEdge` / `panelOffset`），
  并有 9 条几何单元测试兜底。
- **Git 分区数据**：DSH 客户端没有 git 投影，本包的 git 数据来自宿主半区注册的只读路由
  （`ctx.shell` 跑 `git status`），形状与 ZCode 的 `gitSummary` 对齐。

## 本插件的许可

代码 MIT（见 [`LICENSE`](LICENSE)）。其中移植自 ZCode 的部分继续遵循 Apache-2.0。

## 与 DeepSeek Harness 的关系

本插件是 **DeepSeek Harness（DSH，<https://github.com/deepseek-ai/deepseek-harness>）的第三方插件**，
不是其官方组件。DSH 的 slot 契约、会话投影与客户端服务 API 均以其官方文档与源码为准。

本插件的名字、包名与 ZCode 项目不存在隶属关系；上游名称与商标归其各自所有者。