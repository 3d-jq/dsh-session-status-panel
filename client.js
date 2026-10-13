/**
 * 会话状态面板（dsh-session-status-panel）—— 浏览器半区。
 *
 * 约束（见 DSH cordis-plugin-development / ui-plugin 参考）：
 *   - 纯 JavaScript：无 JSX、无 TypeScript、不 import 模块；React 来自浏览器模块表。
 *   - 不使用任何 Harness Client 包；样式只用 --dsw-* 主题令牌与宿主的排版轴变量。
 *   - 只通过 slot 贡献 UI，不写 document.body、不读别人的 DOM。
 *
 * 版式与信息优先级参照 ZCode 的 ConversationStatusPanel（Apache-2.0）：
 *   收起态 = 单行胶囊，按「当前待办 → 未完成目标 → 已完成目标 → 最近完成的待办 → 后台运行数」取第一个可用项；
 *   展开态 = 分区面板（目标 / 进程 / 后台 / 智能体），数据全部来自 DSH 自己的投影与客户端服务。
 * 详见同目录 README.md 与 NOTICE.md。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-status-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    // __ZCODE_MODEL_BEGIN__
    /**
     * 1:1 移植自 ZCode 的会话状态面板模型层
     * ─────────────────────────────────────────────────────────────────────────
     * 上游：ZCode（https://github.com/zai-org/ZCode，Apache License 2.0）
     * 源文件：packages/ui/src/v4/conversationStatusPanelModel.ts（385 行，逐字搬运）
     *        packages/ui/src/v4/conversationLayout.ts
     *        packages/ui/src/v4/conversationGoalSummaryModel.ts
     *
     * 移植时唯一的改动是**数据入口适配**：ZCode 的输入是 ZCode 自己的协议类型
     * （PlanState / BackgroundWorkSummary / RunningSubagentSummary / GoalState /
     * WorkflowRunState / ToolCallRow / GitRepositorySummary），DSH 侧的数据来自
     * 会话投影与 jobs roster。`buildConversationStatusPanelModel` 的函数签名与
     * 全部显示规则（优先级、计数、降级行、Stop 判据、空态判定）保持原样，
     * 由 `adaptToZCodeInput` 把 DSH 数据喂进去。
     *
     * 未搬运的部分（DSH 侧没有对应数据源，见 README「已知限制」）：
     *   - git 分区所需的数据由宿主半区的只读路由提供，形状与 ZCode 的 gitSummary 对齐；
     *   - sessionPlans（ExitPlanMode 记录）DSH 没有对应投影，恒为 null。
     */

    // ─────────────────────────────────────────────────────────── 类型（原样）
    function buildConversationStatusPanelModel(input) {
      const git = input.isOfficeMode ? null : buildGitModel(input);
      const goal = input.goal ?? null;
      const sessionPlans = buildSessionPlansModel(input.sessionPlans, input.workspacePath);
      const plan = buildPlanModel(input.plan);
      const runningBashWorks = [];
      const workflowWorkByWorkId = new Map();
      const subagentControlByChildSessionId = new Map();
      for (const work of input.backgroundWorks ?? []) {
        if (work.kind === 'workflow') {
          // "workflow" 只按 workId ≡ runId 进 workflow 联接表，不留在 runningBashWorks 里
          // （否则同一个 run 会在两个分区各出现一次）。这一支收在 running 闸门之前：
          // 题名与启动时刻对已结束的 work 依然有效，status 判断留到 buildRunningWorkflowRuns。
          workflowWorkByWorkId.set(work.workId, work);
          continue;
        }
        if (work.status !== 'running') continue;
        if (work.kind === 'bash') {
          runningBashWorks.push(work);
        } else if (work.kind === 'subagent' && work.childSessionId) {
          // 只接受唯一 childSessionId 精确匹配；重复或缺失身份时宁可不显示控制，
          // 也不能按标题、时间猜测并停止错误任务。
          const existing = subagentControlByChildSessionId.get(work.childSessionId);
          subagentControlByChildSessionId.set(
            work.childSessionId,
            existing === undefined ? work : null,
          );
        }
      }
      const runningSubagentWorks = (input.runningSubagents ?? []).map((subagent) => {
        const controlWork = subagentControlByChildSessionId.get(subagent.childSessionId);
        if (!controlWork) return subagent;
        return {
          ...subagent,
          controlWorkId: controlWork.workId,
          cancellable: controlWork.cancellable !== false,
        };
      });
      const projectedChildSessionIds = new Set(
        runningSubagentsSafe(runningSubagentWorks).map((subagent) => subagent.childSessionId),
      );
      for (const [childSessionId, controlWork] of subagentControlByChildSessionId) {
        if (!controlWork || projectedChildSessionIds.has(childSessionId)) continue;
        // backgroundWorks 已有精确 childSessionId 的 running 事实，但 subagents
        // 投影交接的短窗口可能暂时缺行；只用唯一身份的权威 work 补齐同一控制，
        // 重复身份仍拒绝猜测。
        runningSubagentWorks.push({
          agentId: controlWork.workId,
          childSessionId,
          controlWorkId: controlWork.workId,
          subagentType: 'subagent',
          title: controlWork.title,
          status: controlWork.blocked ? 'blocked' : 'running',
          startedAt: controlWork.startedAt,
          cancellable: controlWork.cancellable !== false,
        });
      }

      const runningWorkflowRuns = buildRunningWorkflowRuns(input.workflowRuns, workflowWorkByWorkId);

      return {
        git,
        goal,
        sessionPlans,
        plan,
        runningBashWorks,
        runningSubagentWorks,
        runningWorkflowRuns,
        hasContent: Boolean(
          git ||
            goal ||
            sessionPlans ||
            plan ||
            runningBashWorks.length > 0 ||
            runningSubagentWorks.length > 0 ||
            runningWorkflowRuns.length > 0,
        ),
      };
    }

    function runningSubagentsSafe(rows) {
      return rows;
    }

    function buildGitModel({
      gitSummary,
      gitDirtyFileCount = 0,
      gitWorktreeChangeSummary,
    }) {
      if (!gitSummary || !gitSummary.isGitAvailable || !gitSummary.isRepository) {
        return null;
      }
      const added = gitWorktreeChangeSummary ? gitWorktreeChangeSummary.added : 0;
      const removed = gitWorktreeChangeSummary ? gitWorktreeChangeSummary.removed : 0;
      // 只在 worktree 有行级变化时展示 Git Tools（clean repo 不挂状态卡）。
      if (added + removed <= 0) {
        return null;
      }
      const isClean =
        !gitSummary.isDirty &&
        gitDirtyFileCount === 0 &&
        added === 0 &&
        removed === 0 &&
        gitSummary.ahead === 0;

      return {
        branchName: gitSummary.branchName,
        headRefType: gitSummary.headRefType,
        dirtyFileCount: gitDirtyFileCount,
        added,
        removed,
        ahead: gitSummary.ahead,
        behind: gitSummary.behind,
        isClean,
      };
    }

    function buildPlanModel(plan) {
      if (!plan || plan.items.length === 0) {
        return null;
      }
      const completed = plan.items.filter((item) => item.status === 'completed');
      return {
        items: plan.items,
        // 按状态重新分组会让 Todo 完成时跳到列表末尾，破坏 snapshot 的权威顺序。
        // 这里完整保留原数组，滚动与状态样式由 renderer 负责。
        displayItems: plan.items,
        completedCount: completed.length,
        waitingCount: plan.items.length - completed.length,
        totalCount: plan.items.length,
      };
    }

    function buildSessionPlansModel(rows, workspacePath) {
      // DSH 侧没有 ExitPlanMode 记录投影，恒为 null（见文件头说明）。
      return null;
    }

    function workflowRunOpenTarget(run) {
      if (!run || !run.toolCallId) return null;
      const workflowName = run.title && run.title !== run.runId ? run.title : undefined;
      return {
        runId: run.runId,
        toolCallId: run.toolCallId,
        ...(workflowName ? { workflowName } : {}),
      };
    }

    function resolveSoleRunningWorkflowRunTarget(model) {
      if (model.runningBashWorks.length > 0 || model.runningSubagentWorks.length > 0) return null;
      if (model.runningWorkflowRuns.length !== 1) return null;
      return workflowRunOpenTarget(model.runningWorkflowRuns[0]);
    }

    /**
     * Workflows 分区：活动 run 与 workflow 后台任务按 workId ≡ runId 联接。
     * 缺席处理按字段含义分簇：
     *   - title / startedAt 是静态元数据，work 任何 status 都取；
     *   - workId / cancellable 是 Stop 的前提，只在 work 仍 running 时给；
     *   - run 有 work 全无：仍成行，只是没题名/时长/Stop；
     *   - work 有 run 无：降级成只有题名/时长/Stop 的一行，追加在末尾
     *     （它没有启动序上的位置，插进中间等于编造顺序）。
     */
    function buildRunningWorkflowRuns(runs, workflowWorkByWorkId) {
      const rows = [];
      const joinedWorkIds = new Set();
      for (const run of runs ?? []) {
        // pending 也是活动态：run 已起跑只是没派发第一个节点，藏起来会让用户在
        // 「工作流启动了」和「面板出现它」之间看到空窗。
        if (run.status !== 'pending' && run.status !== 'running') continue;
        const work = workflowWorkByWorkId.get(run.runId);
        if (work) joinedWorkIds.add(run.runId);
        const steps = workflowRunStepCounts(run);
        rows.push({
          runId: run.runId,
          ...(run.toolCallId ? { toolCallId: run.toolCallId } : {}),
          status: run.status,
          nodesSettled: steps.settled,
          nodesTotal: steps.total,
          ...(work ? { title: work.title, startedAt: work.startedAt } : {}),
          ...(work && work.status === 'running'
            ? {
                workId: work.workId,
                // 缺省即可停：能停而不给按钮比反过来更糟。
                cancellable: work.cancellable !== false,
              }
            : {}),
        });
      }
      // 顺序 = 投影 runs 序 = 启动序，模型不排序；重排会让面板行在每次投影更新时跳位。
      for (const [workId, work] of workflowWorkByWorkId) {
        if (joinedWorkIds.has(workId) || work.status !== 'running') continue;
        rows.push({
          runId: workId,
          workId,
          title: work.title,
          startedAt: work.startedAt,
          cancellable: work.cancellable !== false,
        });
      }
      return rows;
    }

    /**
     * 与 @zcode/shared 的 workflowRunStepCounts 同源：表内 + 表外。
     *
     * 逐字对照上游（packages/shared/src/zcode-protocol-v4/workflow-runs-caps.ts:118）：
     * 「已结算」的判据是 **node.phase === 'settled'**，不是 status——status 是 StepRunStatus
     * （pending/running/done/failed），phase 才是节点的结算相位。按 status 判会把 done 但相位
     * 未结算的节点也算进去，步数虚高。
     */
    function workflowRunStepCounts(run) {
      let settledInList = 0;
      for (const node of run.nodes) if (node.phase === 'settled') settledInList += 1;
      return {
        total: run.nodes.length + (run.usage.nodesUnlisted ?? 0),
        settled: settledInList + (run.usage.nodesUnlistedSettled ?? 0),
      };
    }

    // ───────────────────────────────────────────────────── conversationLayout
    // 上游：packages/ui/src/v4/conversationLayout.ts（逐字搬运）
    const CONVERSATION_DRAFT_CONTENT_WIDTH_CLASS_NAME = 'max-w-2xl';
    const CONVERSATION_CONTENT_WITH_STATUS_PANEL_WIDTH_CLASS_NAME =
      'w-full @min-[864px]/conversation:w-[calc(100%_-_6rem)] @min-[864px]/conversation:max-w-4xl @min-[1280px]/conversation:w-[calc(100%_-_24rem)] @min-[1280px]/conversation:max-w-6xl';
    const CONVERSATION_CONTENT_WITHOUT_STATUS_PANEL_WIDTH_CLASS_NAME =
      'w-full @min-[864px]/conversation:w-[calc(100%_-_6rem)] @min-[864px]/conversation:max-w-4xl @min-[1280px]/conversation:w-[calc(100%_-_24rem)] @min-[1280px]/conversation:max-w-6xl';
    const CONVERSATION_STATUS_PANEL_WIDE_OFFSET_CLASS_NAME = '@min-[1280px]/conversation:-translate-x-42';

    function getConversationContentWidthClassName({ centeredEmptyLayout, statusPanelLayout }) {
      if (centeredEmptyLayout) return CONVERSATION_DRAFT_CONTENT_WIDTH_CLASS_NAME;
      return statusPanelLayout === 'none'
        ? CONVERSATION_CONTENT_WITHOUT_STATUS_PANEL_WIDTH_CLASS_NAME
        : CONVERSATION_CONTENT_WITH_STATUS_PANEL_WIDTH_CLASS_NAME;
    }

    function resolveConversationStatusPanelVariant({ variantOverride }) {
      return variantOverride ?? 'auto';
    }

    function shouldUseConversationStatusPanelInlineLayout({ hasContent, variant }) {
      return hasContent && variant !== 'mini';
    }

    function getConversationStatusPanelOffsetClassName(layout) {
      return layout === 'none' ? undefined : CONVERSATION_STATUS_PANEL_WIDE_OFFSET_CLASS_NAME;
    }
    // __ZCODE_MODEL_END__

// __DSH_ICONS_BEGIN__
/**
 * 图标集 —— 从 DSH 宿主 `ui-primitives` 抄 path，**不 import 宿主包**。
 *
 * 为什么抄而不 import：`cordis-plugin-development/references/practices.md` 要求插件
 * 不得 import `@deepseek-ai/dsh-client-ui-*`（它们随时可能变，也会让普通 JS 插件失去类型检查）。
 * 图标是纯 path 数据，抄进来符合"复制 primitive 的 markup"，且零 import。
 *
 * 上游 `packages/client/ui-primitives/src/icons/index.tsx` 的规范：
 *   viewBox="0 0 16 16"；描边字形 stroke="currentColor"、填充字形 fill="currentColor"；
 *   ICON_REGULAR_STROKE = 1 / ICON_MEDIUM_STROKE = 1.3。
 * 下面每个数组的元素形如 ['path', { d: '…', stroke: 'currentColor' }]，
 * 由 createElement 逐个构建（**不使用 dangerouslySetInnerHTML**）。
 *
 * 命名对应 ZCode 面板各分区的图标语义（ZCode 用 lucide；这里换成宿主图标集）。
 * 上游没有的名字都注明替换来源。
 */

/** 描边字形：每个 path 自带 stroke=currentColor，不依赖属性继承。 */
const STROKED = {
  // ZCode: TargetIcon → 上游 IconGoalOutline
  goal: [
    ['path', { d: 'M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5', stroke: 'currentColor' }],
    ['path', { d: 'M11.5 8C11.5001 8.69227 11.2948 9.36901 10.9102 9.94463C10.5257 10.5202 9.97901 10.9689 9.33944 11.2338C8.69986 11.4987 7.99609 11.5681 7.31712 11.433C6.63816 11.2979 6.01449 10.9645 5.52501 10.475C5.03548 9.98552 4.70209 9.36185 4.56702 8.68289C4.43195 8.00392 4.50127 7.30015 4.76619 6.66057C5.03112 6.021 5.47976 5.47436 6.05538 5.08978C6.631 4.70519 7.30774 4.49995 8.00001 4.5', stroke: 'currentColor' }],
    ['path', { d: 'M8.00024 7.99976L11.2 4.80005', stroke: 'currentColor' }],
    ['path', { d: 'M12.4719 5.62245C12.4246 5.66972 12.3569 5.69025 12.2913 5.67715L10.7814 5.37555C10.7022 5.35972 10.6402 5.29781 10.6244 5.2186L10.3228 3.70866C10.3097 3.6431 10.3302 3.57533 10.3775 3.52806L12.1826 1.723C12.2863 1.61929 12.4627 1.65879 12.5122 1.79684L12.9271 2.95225C12.9472 3.00847 12.9915 3.05272 13.0477 3.07291L14.2031 3.48774C14.3412 3.5373 14.3807 3.71368 14.277 3.81739L12.4719 5.62245Z', stroke: 'currentColor' }],
  ],
  // ZCode: ListChecksIcon → 上游 IconChecklistOutline
  checklist: [
    ['path', { d: 'M3.75 6.25C4.7165 6.25 5.5 5.4665 5.5 4.5C5.5 3.5335 4.7165 2.75 3.75 2.75C2.7835 2.75 2 3.5335 2 4.5C2 5.4665 2.7835 6.25 3.75 6.25Z', stroke: 'currentColor' }],
    ['path', { d: 'M7.5 4.5H13.5', stroke: 'currentColor' }],
    ['path', { d: 'M3.75 13.25C4.7165 13.25 5.5 12.4665 5.5 11.5C5.5 10.5335 4.7165 9.75 3.75 9.75C2.7835 9.75 2 10.5335 2 11.5C2 12.4665 2.7835 13.25 3.75 13.25Z', stroke: 'currentColor' }],
    ['path', { d: 'M7.5 11.5H13.5', stroke: 'currentColor' }],
  ],
  // ZCode: SquareTerminalIcon → 上游无 terminal 名，取该图标集的 '>_' 提示符（IconApiOutline）
  terminal: [
    ['path', { d: 'M3 4L7 8L3 12', stroke: 'currentColor' }],
    ['path', { d: 'M9 12H13', stroke: 'currentColor' }],
  ],
  // ZCode: BotIcon → 上游无 bot，取智能体字形（IconAgentPresetOutline）
  agent: [
    ['path', { d: 'M6.51867 12.3282C7.29816 12.6011 8.16475 12.6514 9.02269 12.4216C9.57879 12.2726 10.0784 12.0185 10.5087 11.6888C10.7819 12.0555 11.1606 12.3304 11.5913 12.4805C10.9688 13.029 10.2149 13.4478 9.35911 13.6771C8.13946 14.0038 6.90632 13.8971 5.82126 13.4533C6.15821 13.1562 6.4021 12.7652 6.51867 12.3282ZM9.17629 2.89409C11.1101 3.34433 12.739 4.81872 13.2889 6.87043C13.4219 7.3665 13.4811 7.8649 13.4774 8.35466C13.0924 8.13213 12.6422 8.01837 12.1741 8.05276L12.1711 8.05257C12.1539 7.77199 12.109 7.48889 12.0334 7.20684C11.6363 5.72533 10.5048 4.6372 9.13549 4.22844C9.25559 3.87667 9.29214 3.49087 9.22309 3.09892C9.2108 3.02922 9.19451 2.96108 9.17629 2.89409ZM4.7311 3.89107L4.78302 4.11879C4.87648 4.4488 5.04146 4.74263 5.25579 4.98896C3.98078 6.01355 3.35848 7.72904 3.8089 9.41059C3.81828 9.44559 3.82866 9.48025 3.83885 9.51479C3.38217 9.61268 2.98548 9.84137 2.68107 10.1556C2.63414 10.022 2.5897 9.88632 2.55244 9.74726C1.93301 7.43489 2.86717 5.07173 4.71504 3.76697L4.7311 3.89107Z', fill: 'currentColor' }],
    ['path', { d: 'M7.99136 5.28105C8.87501 5.28105 9.59136 4.56471 9.59136 3.68105C9.59136 2.7974 8.87501 2.08105 7.99136 2.08105C7.1077 2.08105 6.39136 2.7974 6.39136 3.68105C6.39136 4.56471 7.1077 5.28105 7.99136 5.28105Z', stroke: 'currentColor' }],
    ['path', { d: 'M3.94009 12.9417C4.82374 12.9417 5.54009 12.2254 5.54009 11.3417C5.54009 10.458 4.82374 9.7417 3.94009 9.7417C3.05643 9.7417 2.34009 10.458 2.34009 11.3417C2.34009 12.2254 3.05643 12.9417 3.94009 12.9417Z', stroke: 'currentColor' }],
    ['path', { d: 'M12.0851 12.9417C12.9688 12.9417 13.6851 12.2254 13.6851 11.3417C13.6851 10.458 12.9688 9.7417 12.0851 9.7417C11.2015 9.7417 10.4851 10.458 10.4851 11.3417C10.4851 12.2254 11.2015 12.9417 12.0851 12.9417Z', stroke: 'currentColor' }],
  ],
  // ZCode: FileDiffIcon → 上游无 diff 名，取并排双文档（IconCompareSplitOutline）
  diff: [
    ['path', { d: 'M6 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H6C6.55228 14.5 7 14.0523 7 13.5V2.5C7 1.94772 6.55228 1.5 6 1.5Z', stroke: 'currentColor' }],
    ['path', { d: 'M13.5 1.5H10C9.44772 1.5 9 1.94772 9 2.5V13.5C9 14.0523 9.44772 14.5 10 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z', stroke: 'currentColor' }],
  ],
  // ZCode: ChevronRightIcon / ChevronDownIcon / ChevronLeftIcon / ChevronUpIcon → 上游同名
  chevronRight: [['path', { d: 'M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4', stroke: 'currentColor' }]],
  chevronDown: [['path', { d: 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6', stroke: 'currentColor' }]],
  chevronLeft: [['path', { d: 'M10 4L6.70711 7.29289C6.31658 7.68342 6.31658 8.31658 6.70711 8.70711L10 12', stroke: 'currentColor' }]],
  chevronUp: [['path', { d: 'M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10', stroke: 'currentColor' }]],
  // ZCode: RefreshCwIcon（git 分区刷新）→ 上游 IconRefreshOutline
  refresh: [
    ['path', { d: 'M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5C9.9001 1.5 11.7001 2.3 13.0001 3.6L14.5001 5.1', stroke: 'currentColor' }],
    ['path', { d: 'M14.4999 1.5V5.1H10.8999', stroke: 'currentColor' }],
  ],
  // ZCode: PauseIcon（目标暂停）→ 上游 IconPauseOutline（圆圈内双竖线）
  pause: [
    ['path', { d: 'M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z', stroke: 'currentColor' }],
    ['path', { d: 'M6.5 5V11', stroke: 'currentColor' }],
    ['path', { d: 'M9.5 5V11', stroke: 'currentColor' }],
  ],
  // ZCode: PlayIcon（目标继续）→ 上游 IconPlayOutline（圆圈内三角）
  play: [
    ['path', { d: 'M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z', stroke: 'currentColor' }],
    ['path', { d: 'M10.3329 7.91346C10.3996 7.95195 10.3996 8.04818 10.3329 8.08667L6.78304 10.1362C6.71638 10.1747 6.63304 10.1266 6.63304 10.0496L6.63304 5.95055C6.63304 5.87357 6.71638 5.82546 6.78304 5.86395L10.3329 7.91346Z', stroke: 'currentColor' }],
  ],
  // ZCode: CircleIcon（待处理项）→ 上游没有裸圆，取 IconClockOutline 的圆
  circle: [['path', { d: 'M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z', stroke: 'currentColor' }]],
};

/** 填充字形：fill=currentColor（描边宽度对其无效）。 */
const FILLED = {
  // ZCode: MoreHorizontalIcon（⋯）→ 上游 IconEllipsisOutline
  ellipsis: [
    ['path', { d: 'M3 9C3.55228 9 4 8.55228 4 8C4 7.44772 3.55228 7 3 7C2.44772 7 2 7.44772 2 8C2 8.55228 2.44772 9 3 9Z', fill: 'currentColor' }],
    ['path', { d: 'M8 9C8.55228 9 9 8.55228 9 8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8C7 8.55228 7.44772 9 8 9Z', fill: 'currentColor' }],
    ['path', { d: 'M13 9C13.5523 9 14 8.55228 14 8C14 7.44772 13.5523 7 13 7C12.4477 7 12 7.44772 12 8C12 8.55228 12.4477 9 13 9Z', fill: 'currentColor' }],
  ],
  // ZCode: SquareIcon（停止按钮）→ 上游 IconStopFill
  stop: [
    ['path', { d: 'M12.5 2.5H3.5C2.94772 2.5 2.5 2.94772 2.5 3.5V12.5C2.5 13.0523 2.94772 13.5 3.5 13.5H12.5C13.0523 13.5 13.5 13.0523 13.5 12.5V3.5C13.5 2.94772 13.0523 2.5 12.5 2.5Z', fill: 'currentColor' }],
  ],
  // ZCode: CheckIcon → 上游 IconCheckCircleOutline（名字带 Outline 但几何是填充）
  check: [
    ['path', { d: 'M12.5303 6.53027L8.80273 10.2578C8.54967 10.5109 8.31796 10.7439 8.10645 10.9141C7.88375 11.0932 7.616 11.2602 7.27344 11.3145C7.09229 11.3431 6.90771 11.3431 6.72656 11.3145C6.384 11.2602 6.11625 11.0932 5.89355 10.9141C5.68204 10.7439 5.45033 10.5109 5.19727 10.2578L3.46973 8.53027L4.53027 7.46973L6.25781 9.19727C6.53457 9.47402 6.70036 9.63859 6.83398 9.74609C6.95637 9.84453 6.98241 9.83644 6.96094 9.83301C6.98679 9.83709 7.01321 9.83709 7.03906 9.83301C7.01759 9.83644 7.04363 9.84453 7.16602 9.74609C7.29964 9.63859 7.46543 9.47402 7.74219 9.19727L11.4697 5.46973L12.5303 6.53027Z', fill: 'currentColor' }],
    ['path', { d: 'M14.5996 8C14.5996 4.35492 11.6451 1.40039 8 1.40039C4.35492 1.40039 1.40039 4.35492 1.40039 8C1.40039 11.6451 4.35492 14.5996 8 14.5996C11.6451 14.5996 14.5996 11.6451 14.5996 8ZM15.9004 8C15.9004 12.363 12.363 15.9004 8 15.9004C3.63695 15.9004 0.0996094 12.363 0.0996094 8C0.0996094 3.63695 3.63695 0.0996094 8 0.0996094C12.363 0.0996094 15.9004 3.63695 15.9004 8Z', fill: 'currentColor' }],
  ],
  // ZCode: ArrowRightIcon（当前待办标记）→ 上游无箭头，取实心右三角（IconTriangleRightFill）
  arrowRight: [
    ['path', { d: 'M5.5 4.5C5.5 4.40714 5.52586 4.31612 5.57467 4.23713C5.62349 4.15815 5.69334 4.09431 5.77639 4.05279C5.85945 4.01126 5.95242 3.99368 6.0449 4.00202C6.13738 4.01036 6.22572 4.04429 6.3 4.1L10.967 7.6C11.0291 7.64657 11.0795 7.70697 11.1142 7.77639C11.1489 7.84582 11.167 7.92238 11.167 8C11.167 8.07762 11.1489 8.15418 11.1142 8.22361C11.0795 8.29303 11.0291 8.35343 10.967 8.4L6.3 11.9C6.22572 11.9557 6.13738 11.9896 6.0449 11.998C5.95242 12.0063 5.85945 11.9887 5.77639 11.9472C5.69334 11.9057 5.62349 11.8419 5.57467 11.7629C5.52586 11.6839 5.5 11.5929 5.5 11.5V4.5Z', fill: 'currentColor' }],
  ],
};
// __DSH_ICONS_END__

    // ------------------------------------------------------------ 文案字典
    /** locale 命名空间（本包自有）。 */
    const NS = 'sessionStatusPanel';
    /** 简体中文（键集真源）。 */
    const ZH = {
      'panel.title': '状态',
      'panel.aria': '会话状态',
      'panel.expand': '展开状态',
      'panel.collapse': '收起为胶囊',
      'section.goal': '目标',
      'section.progress': '进程',
      'section.background': '后台',
      'section.agents': '智能体',
      'section.workflow': '工作流',
      'goal.pause': '暂停目标',
      'goal.resume': '继续目标',
      'goal.clear': '清除目标',
      'goal.actionFailed': '目标操作失败：{error}',
      'panel.mode': '展开策略',
      'panel.mode.auto': '自动（每次打开为收起态）',
      'panel.mode.expanded': '始终展开',
      'panel.mode.collapsed': '始终收起',
      'job.stop': '停止任务 {label}',
      'job.stop.short': '停止',
      'job.killFailed': '停止失败：{error}',
      'goal.untitled': '未命名目标',
      'goal.round': '第 {started} / {max} 轮',
      'goal.status.active': '进行中',
      'goal.status.paused': '已暂停',
      'goal.status.blocked': '已阻塞',
      'goal.status.complete': '已完成',
      'goal.status.unknown': '未知',
      'duration.hours': '{hours} 小时',
      'duration.minutes': '{minutes} 分',
      'duration.seconds': '{seconds} 秒',
      'todo.fold.completed': '已完成 {count} 项',
      'todo.fold.earlier': '前面 {count} 项',
      'todo.fold.waiting': '待处理 {count} 项',
      'todo.fold.later': '后面 {count} 项',
      'todo.fold.aria': '展开这 {count} 项',
      'job.status.running': '运行中',
      'job.status.stopping': '停止中',
      'job.status.completed': '已完成',
      'job.status.killed': '已停止',
      'job.status.failed': '失败',
      'job.count.live.one': '{count} 运行中',
      'job.count.live.other': '{count} 运行中',
      'job.output.open': '查看输出：{label}',
      'job.output.close': '收起输出：{label}',
      'job.output.loading': '正在读取输出…',
      'job.output.empty': '（暂无输出）',
      'job.output.gap': '…（更早的输出已截断）',
      'job.output.streaming': '实时更新中',
      'capsule.running.one': '{count} 个后台任务运行中',
      'capsule.running.other': '{count} 个后台任务运行中',
      'agent.mode.continuable': '可续聊',
      'agent.mode.oneShot': '一次性',
      'agent.mode.unknown': '未知',
      'agent.open': '打开子智能体会话：{label}',
    };
    /** English（键集与中文逐字对应）。 */
    const EN = {
      'panel.title': 'Status',
      'panel.aria': 'Session status',
      'panel.expand': 'Expand status',
      'panel.collapse': 'Collapse to capsule',
      'section.goal': 'Goal',
      'section.progress': 'Progress',
      'section.background': 'Background',
      'section.agents': 'Agents',
      'section.workflow': 'Workflows',
      'goal.pause': 'Pause goal',
      'goal.resume': 'Resume goal',
      'goal.clear': 'Clear goal',
      'goal.actionFailed': 'Goal action failed: {error}',
      'panel.mode': 'Display mode',
      'panel.mode.auto': 'Auto (collapsed on open)',
      'panel.mode.expanded': 'Always expanded',
      'panel.mode.collapsed': 'Always collapsed',
      'job.stop': 'Stop task {label}',
      'job.stop.short': 'Stop',
      'job.killFailed': 'Stop failed: {error}',
      'goal.untitled': 'Untitled goal',
      'goal.round': 'Round {started} / {max}',
      'goal.status.active': 'active',
      'goal.status.paused': 'paused',
      'goal.status.blocked': 'blocked',
      'goal.status.complete': 'complete',
      'goal.status.unknown': 'unknown',
      'duration.hours': '{hours}h',
      'duration.minutes': '{minutes}m',
      'duration.seconds': '{seconds}s',
      'todo.fold.completed': '{count} completed',
      'todo.fold.earlier': '{count} earlier',
      'todo.fold.waiting': '{count} waiting',
      'todo.fold.later': '{count} later',
      'todo.fold.aria': 'Show these {count} items',
      'job.status.running': 'running',
      'job.status.stopping': 'stopping',
      'job.status.completed': 'completed',
      'job.status.killed': 'stopped',
      'job.status.failed': 'failed',
      'job.count.live.one': '{count} running',
      'job.count.live.other': '{count} running',
      'job.output.open': 'Show output: {label}',
      'job.output.close': 'Hide output: {label}',
      'job.output.loading': 'Reading output…',
      'job.output.empty': '(no output)',
      'job.output.gap': '… earlier output truncated …',
      'job.output.streaming': 'live',
      'capsule.running.one': '{count} background task running',
      'capsule.running.other': '{count} background tasks running',
      'agent.mode.continuable': 'continuable',
      'agent.mode.oneShot': 'one-shot',
      'agent.mode.unknown': 'unknown',
      'agent.open': 'Open subagent session: {label}',
    };

    /**
     * `{name}` 模板替换。locale 服务在场时用框架注入的 `t`（跟随语言切换重渲染）；
     * 不在场时退回本包的 zh 字典并自行替换，保证面板不会因为缺 locale 服务而失效。
     */
    function translate(fallbackDict, t, key, params) {
      if (t) return t(key, params);
      let text = fallbackDict[key] || key;
      if (params) {
        Object.keys(params).forEach(function (name) {
          text = text.split('{' + name + '}').join(String(params[name]));
        });
      }
      return text;
    }

    // ---------------------------------------------------------------- 设计令牌
    const TOKEN = {
      surface: 'var(--dsw-alias-bg-overlay)',
      hover: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      brand: 'var(--dsw-alias-brand-primary)',
    };
    const RADIUS_SHELL = 16;
    const SHELL_WIDTH = 384;
    /**
     * 沿用宿主的正文排版轴，而不是写死 px：字号设置变化（本 profile 设了 fontSize 16）
     * 时面板跟着变，行高用同一套 delta 变量推导，宿主怎么长面板就怎么长。
     */
    const FONT_BASE = 'var(--dsh-content-font-size, 14px)';
    const FONT_SMALL = 'var(--dsh-content-font-size-secondary, 13px)';
    const LEAD_BASE = 'calc(22px + var(--dsh-content-font-delta, 0px))';
    const LEAD_SMALL = 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))';

    /** 多行截断（宿主列表行的 line-clamp 等价物）。 */
    function clampLines(lines) {
      return {
        display: '-webkit-box',
        WebkitLineClamp: lines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      };
    }

    /**
     * 状态点，对齐宿主 StateDot 的语言：running 实心、pending 空心环、
     * failed 实心带 30% 同色外环；而不是我原来那种一色实心圆。
     */
    function statusDotStyle(color, shape) {
      const base = {
        display: 'block',
        width: 8,
        height: 8,
        flex: 'none',
        boxSizing: 'border-box',
        borderRadius: 999,
      };
      if (shape === 'hollow') {
        return Object.assign(base, { border: '1.5px solid ' + color, background: 'transparent' });
      }
      if (shape === 'ring') {
        return Object.assign(base, {
          background: color,
          boxShadow: '0 0 0 2px color-mix(in srgb, ' + color + ' 30%, transparent)',
        });
      }
      return Object.assign(base, { background: color });
    }
    /**
     * 右上角浮层锚点。用宿主发布的变量推导顶部偏移，而不是写死像素：
     *   --dsh-frame-top-clearance   macOS 的顶部条带高度（Windows 上未声明，取 0）
     *   --dsh-windows-titlebar-height  Windows 自绘标题栏高度
     * 两者都缺失时退化为 8px（普通浏览器环境）。层本身点击穿透，由子元素重新接管指针。
     * z-index 与宿主自身的固定浮层（ContextMeter 展开面板）保持一致。
     */
    const ANCHOR_STYLE = {
      position: 'fixed',
      top: 'calc(var(--dsh-frame-top-clearance, 0px) + var(--dsh-windows-titlebar-height, 0px) + 8px)',
      right: 16,
      zIndex: 1100,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 6,
      pointerEvents: 'none',
    };
    const CAPSULE_HEIGHT = 34;
    const TODO_COMPACT_THRESHOLD = 6;
    const TODO_FOCUS_WINDOW = 3;
    const SECTION_SCROLL_CAP = { goal: '12rem', plan: '20rem', background: '12rem', agents: '12rem' };

    // ------------------------------------------------------------------ 图标
    /*
     * 图标来自 dsh-icons.js（由 build-client.mjs 内联）：path 逐字抄自 DSH 宿主
     * ' + "'" + 'ui-primitives/src/icons/index.tsx' + "'" + '，viewBox 0 0 16 16、
     * currentColor、描边 1px —— 与宿主同一套网格与重量。
     * （早先这里 8 个图标是手搓的 24 网格 path，粗细与比例都不一致。）
     *
     * 逐 path 用 createElement 构建（不用 dangerouslySetInnerHTML）：
     * 每个 path 自带 stroke/fill，不依赖 <svg> 的属性继承，
     * 这样与上游写法一致，也不把字符串当 HTML 注入。
     */
    function iconFrom(spec) {
      return function DshIcon(props) {
        const size = (props && props.size) || 16;
        const nodes = [];
        for (let i = 0; i < spec.length; i += 1) {
          const tag = spec[i][0];
          const attrs = Object.assign({}, spec[i][1], { key: 'p' + i });
          nodes.push(h(tag, attrs));
        }
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 16 16',
            fill: 'none',
            'aria-hidden': 'true',
            style: { display: 'block', flex: 'none' },
          },
          nodes,
        );
      };
    }

    const GoalIcon = iconFrom(STROKED.goal);
    const ListIcon = iconFrom(STROKED.checklist);
    const TerminalIcon = iconFrom(STROKED.terminal);
    const BotIcon = iconFrom(STROKED.agent);
    const WorkflowIcon = iconFrom(STROKED.agent);
    const RefreshIcon = iconFrom(STROKED.refresh);
    const PauseIcon = iconFrom(STROKED.pause);
    const PlayIcon = iconFrom(STROKED.play);
    const CircleIcon = iconFrom(STROKED.circle);
    const ChevronDownIcon = iconFrom(STROKED.chevronDown);
    const ChevronLeftIcon = iconFrom(STROKED.chevronLeft);
    const ChevronRightIcon = iconFrom(STROKED.chevronRight);
    const EllipsisIcon = iconFrom(FILLED.ellipsis);
    const StopIcon = iconFrom(FILLED.stop);
    const CheckIcon = iconFrom(FILLED.check);
    const ArrowRightIcon = iconFrom(FILLED.arrowRight);
    // 收起 / 展开这一对：ZCode 用 Minimize2 / Maximize2，宿主没有对应字形，
    // 这里用上 / 下 chevron（互为反义，与折叠箭头同族）。
    const MinimizeIcon = iconFrom(STROKED.chevronUp);
    const MaximizeIcon = iconFrom(STROKED.chevronDown);

    // -------------------------------------------------------------- 数据派生
    /**
     * DSH 的 goal 投影是**嵌套**的：`useProjection('goal')` 返回
     * `{ goal: { id, revision, objective, phase, maxGoalRounds, blockedReason? }, roundsStarted, createdAt, updatedAt }`。
     * 宿主自己的 GoalDock 就是这么解包的（ui-goal/src/client/GoalBar.tsx:193）：
     * `const goal = projection == null ? projection : projection.goal`。
     * phase 词表是 'active' | 'paused' | 'blocked' | 'complete'（dsh-goal/src/types.ts:45）。
     */
    function goalSnapshot(projection) {
      if (!projection) return null;
      return projection.goal || null;
    }

    function goalTitle(projection) {
      const snapshot = goalSnapshot(projection);
      const objective =
        snapshot && typeof snapshot.objective === 'string' ? snapshot.objective.trim() : '';
      return objective || null;
    }

    function goalPhase(projection) {
      const snapshot = goalSnapshot(projection);
      return snapshot && typeof snapshot.phase === 'string' ? snapshot.phase : null;
    }

    /** 仍然开放的目标阶段（暂停/阻塞都还算"当前目标"，只有 complete 是终态）。 */
    function goalIsOpen(projection) {
      const phase = goalPhase(projection);
      return phase === 'active' || phase === 'paused' || phase === 'blocked';
    }

    /** 只有 active 才需要每秒走表。 */
    function goalIsTicking(projection) {
      return goalPhase(projection) === 'active';
    }

    /**
     * DSH 目标没有 timeUsedSeconds/activeRunStartedAtMs，用投影自己的
     * createdAt → (active ? now : updatedAt) 作为持续时间。
     */
    function goalElapsedSeconds(projection, now) {
      if (!projection || typeof projection.createdAt !== 'number') return 0;
      const end = goalIsTicking(projection)
        ? now
        : typeof projection.updatedAt === 'number'
          ? projection.updatedAt
          : now;
      return Math.max(0, Math.floor((end - projection.createdAt) / 1000));
    }

    function goalRounds(projection) {
      const snapshot = goalSnapshot(projection);
      const started = projection && typeof projection.roundsStarted === 'number' ? projection.roundsStarted : 0;
      const max = snapshot && typeof snapshot.maxGoalRounds === 'number' ? snapshot.maxGoalRounds : 0;
      return { started, max };
    }

    function goalStatusWord(T, phase) {
      switch (phase) {
        case 'active':
          return T('goal.status.active');
        case 'paused':
          return T('goal.status.paused');
        case 'blocked':
          return T('goal.status.blocked');
        case 'complete':
          return T('goal.status.complete');
        default:
          return T('goal.status.unknown');
      }
    }

    function goalStatusColor(phase) {
      if (phase === 'complete') return TOKEN.success;
      if (phase === 'blocked') return TOKEN.warn;
      return TOKEN.muted;
    }

    function formatSeconds(T, totalSeconds) {
      const total = Math.max(0, Math.floor(totalSeconds));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      const parts = [];
      if (hours > 0) parts.push(T('duration.hours', { hours: hours }));
      if (minutes > 0) parts.push(T('duration.minutes', { minutes: minutes }));
      if (seconds > 0 || parts.length === 0) parts.push(T('duration.seconds', { seconds: seconds }));
      return parts.join(' ');
    }

    function findCurrentTodo(todos) {
      for (let i = 0; i < todos.length; i += 1) {
        if (todos[i].status === 'in_progress') return todos[i];
      }
      for (let i = 0; i < todos.length; i += 1) {
        if (todos[i].status === 'pending') return todos[i];
      }
      return null;
    }

    function findCompletedTodo(todos) {
      for (let i = todos.length - 1; i >= 0; i -= 1) {
        if (todos[i].status === 'completed') return todos[i];
      }
      return null;
    }

    function todoCounts(todos) {
      let completed = 0;
      let active = 0;
      for (let i = 0; i < todos.length; i += 1) {
        if (todos[i].status === 'completed') completed += 1;
        else if (todos[i].status === 'in_progress') active += 1;
      }
      return { completed, active, pending: todos.length - completed - active, total: todos.length };
    }

    /** ZCode 的 Todo 折叠窗口：>6 项时只展示以当前项为中心的 3 项，前后折成计数行。 */
    function todoFocusWindow(todos) {
      if (todos.length <= TODO_COMPACT_THRESHOLD) return null;
      let focus = -1;
      for (let i = 0; i < todos.length; i += 1) {
        if (todos[i].status === 'in_progress') {
          focus = i;
          break;
        }
      }
      if (focus < 0) {
        for (let i = 0; i < todos.length; i += 1) {
          if (todos[i].status !== 'completed') {
            focus = i;
            break;
          }
        }
      }
      if (focus < 0) focus = Math.max(0, todos.length - TODO_FOCUS_WINDOW);
      const start = Math.max(0, Math.min(focus, todos.length - TODO_FOCUS_WINDOW));
      return { start, end: Math.min(todos.length, start + TODO_FOCUS_WINDOW) };
    }

    function useNowTicker(active) {
      const [now, setNow] = useState(function () {
        return Date.now();
      });
      useEffect(
        function () {
          if (!active) return undefined;
          const id = setInterval(function () {
            setNow(Date.now());
          }, 1000);
          return function () {
            clearInterval(id);
          };
        },
        [active],
      );
      return now;
    }

    // ------------------------------------------------------------ 基础样式表
    const rowTextStyle = {
      minWidth: 0,
      flex: '1 1 auto',
      fontSize: FONT_BASE,
      lineHeight: LEAD_BASE,
      overflowWrap: 'anywhere',
      color: TOKEN.text,
    };
    /** 次级文字（元信息行、尾随计数）：走 -secondary 轴。 */
    const metaTextStyle = {
      fontSize: FONT_SMALL,
      lineHeight: LEAD_SMALL,
      color: TOKEN.muted,
      fontVariantNumeric: 'tabular-nums',
    };
    /** 可点击行的悬停反馈：与宿主交互底色一致，并带一个短过渡。 */
    const clickableRowStyle = {
      width: '100%',
      boxSizing: 'border-box',
      border: 0,
      borderRadius: 8,
      font: 'inherit',
      textAlign: 'left',
      color: 'inherit',
      transition: 'background-color 120ms ease',
    };
    const sectionHeaderStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      width: '100%',
      // 必须 border-box：width:100% 与左右各 8px 内边距并存时，content-box
      // 会让外框比容器宽 16px，把尾随计数推出右缘被 overflow:hidden 切掉。
      boxSizing: 'border-box',
      height: 32,
      padding: '0 8px',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: TOKEN.text,
      font: 'inherit',
      textAlign: 'left',
    };
    const scrollBoxStyle = {
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      // 滚动条占位固定，避免它挤掉右侧内容；右侧内边距留出滚动条宽度。
      scrollbarGutter: 'stable',
      boxSizing: 'border-box',
      paddingRight: 6,
    };

    // -------------------------------------------------------------- 子组件
    function TodoRow(props) {
      const item = props.item;
      const done = item.status === 'completed';
      const active = item.status === 'in_progress';
      const color = done ? TOKEN.success : active ? TOKEN.brand : TOKEN.idle;
      // 待处理项用宿主的"空心环"语汇（StateDot pending），不画描边圆形图标。
      const leading = done
        ? h('span', { style: { display: 'flex', color: color, marginTop: 3 } }, h(CheckIcon, { size: 14 }))
        : active
          ? h('span', { style: { display: 'flex', color: color, marginTop: 3 } }, h(ArrowRightIcon, { size: 14 }))
          : h('span', { style: { display: 'flex', marginTop: 5 } }, h('span', { style: statusDotStyle(color, 'hollow') }));
      return h(
        'li',
        {
          'data-todo-status': item.status,
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '6px 8px',
            borderRadius: 8,
            listStyle: 'none',
          },
        },
        leading,
        h(
          'span',
          {
            key: 't',
            title: item.content,
            style: Object.assign({}, rowTextStyle, clampLines(2), {
              textDecoration: done ? 'line-through' : 'none',
              color: done ? TOKEN.muted : TOKEN.text,
            }),
          },
          item.content,
        ),
      );
    }

    /**
     * 折叠行：点击就地展开该组；悬停（或键盘聚焦）140ms 后在面板左侧弹出预览卡。
     * 预览卡坐标先在**视口**里算好（量折叠行自己的 DOM，不碰别人的），再由
     * toPanelSpace() 换算成面板空间——因为面板的 backdrop-filter 会成为 fixed/absolute 的包含块。
     */
    function FoldRow(props) {
      const [hover, setHover] = useState(false);
      const [anchor, setAnchor] = useState(null);
      const timer = useRef(null);
      const clearTimer = function () {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
      };
      useEffect(function () {
        return clearTimer;
      }, []);
      const PREVIEW_WIDTH = 264;
      const show = function (event) {
        setHover(true);
        const items = props.items || [];
        if (items.length === 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        clearTimer();
        timer.current = setTimeout(function () {
          setAnchor(
            panelOffset(panelRect(), {
              // 预览卡放在面板左侧 10px。
              top: clampTop(rect.top - 6, 260, window.innerHeight),
              rightEdge: clampRightEdge(rect.left - 10, PREVIEW_WIDTH, window.innerWidth),
            }),
          );
        }, 140);
      };
      const hide = function () {
        clearTimer();
        setHover(false);
        setAnchor(null);
      };
      return h(
        'li',
        { style: { listStyle: 'none' } },
        h(
          'button',
          {
            type: 'button',
            'data-todo-fold': props.group,
            'aria-expanded': props.expanded === true,
            'aria-label': props.ariaLabel,
            onClick: props.onClick,
            onMouseEnter: show,
            onMouseLeave: hide,
            onFocus: show,
            onBlur: hide,
            style: Object.assign({}, sectionHeaderStyle, {
              height: 30,
              borderRadius: 8,
              color: TOKEN.muted,
              background: hover ? TOKEN.hover : 'transparent',
            }),
          },
          h(props.expanded ? ChevronDownIcon : ChevronLeftIcon, { size: 14 }),
          h(
            'span',
            { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            props.label,
          ),
        ),
        anchor
          ? h(
              'div',
              {
                'data-todo-preview': props.group,
                style: {
                  // relative + 面板空间坐标：面板的 backdrop-filter 会成为包含块，
                  // 所以坐标由 toPanelSpace() 从视口换算而来（详见它的注释）。
                  position: 'relative',
                  top: anchor.top,
                  right: anchor.right,
                  zIndex: 1101,
                  width: 264,
                  maxHeight: 'min(20rem, 60dvh)',
                  overflowY: 'auto',
                  scrollbarGutter: 'stable',
                  boxSizing: 'border-box',
                  padding: 10,
                  background: 'var(--dsw-specific-menu, ' + TOKEN.surface + ')',
                  border: 0,
                  borderRadius: 'var(--dsw-radius-lg, 12px)',
                  boxShadow: 'var(--dsw-elevation-prominent, 0 6px 24px rgba(0,0,0,0.18))',
                  backdropFilter: 'var(--dsw-menu-backdrop-filter, none)',
                  color: TOKEN.text,
                },
              },
              h(
                'span',
                { style: Object.assign({}, metaTextStyle, { display: 'block', marginBottom: 6, padding: '0 2px' }) },
                props.label,
              ),
              h(
                'ul',
                { style: { margin: 0, padding: 0, display: 'flex', flexDirection: 'column' } },
                (props.items || []).map(function (item, index) {
                  return h(TodoRow, { key: 'p' + index, item: item });
                }),
              ),
            )
          : null,
      );
    }

    function Section(props) {
      const [open, setOpen] = useState(props.defaultOpen !== false);
      return h(
        'section',
        {
          'data-status-section': props.id,
          style: {
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            // 分区之间用宿主的分隔线（ZCode 同款：前一分区存在时才有上边线 + 间距）。
            borderTop: props.separated ? '1px solid ' + TOKEN.border : 'none',
            paddingTop: props.separated ? 6 : 0,
          },
        },
        h(
          'div',
          {
            // 不加 ZCode 那个 paddingRight: 32 —— 那是给右上角绝对定位控件让位的，
            // 本面板的收起按钮在标题栏内，多留 32px 只会把尾随计数挤掉。
            style: sectionHeaderStyle,
            'data-status-section-trigger': props.id,
          },
          h(
            'button',
            {
              type: 'button',
              'aria-expanded': open,
              onClick: function () {
                setOpen(function (value) {
                  return !value;
                });
              },
              // minWidth:0 让标题可以收缩省略；尾随计数 flex:none 保住自己的位置。
              style: Object.assign({}, sectionHeaderStyle, {
                width: 'auto',
                flex: '0 1 auto',
                minWidth: 0,
                padding: 0,
                gap: 6,
                overflow: 'hidden',
              }),
            },
            h(ChevronDownIcon, { size: 14 }),
            h('span', { style: { display: 'flex', color: TOKEN.muted } }, h(props.icon, { size: 14 })),
            h(
              'span',
              {
                style: {
                  fontWeight: 500,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              props.title,
            ),
          ),
          h(
            'span',
            {
              style: Object.assign({}, metaTextStyle, {
              marginLeft: 'auto',
              flex: 'none',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }),
            },
            props.trailing || null,
          ),
        ),
        open
          ? h(
              'div',
              {
                'data-status-section-scroll': props.id,
                style: Object.assign({}, scrollBoxStyle, { maxHeight: SECTION_SCROLL_CAP[props.id] || '12rem' }),
              },
              props.children,
            )
          : null,
      );
    }

    function GoalSection(props) {
      const T = props.T;
      const goal = props.goal;
      const phase = goalPhase(goal);
      const now = useNowTicker(goalIsTicking(goal));
      const elapsed = goalElapsedSeconds(goal, now);
      const rounds = goalRounds(goal);
      const snapshot = goalSnapshot(goal);
      const [actionError, setActionError] = useState(null);
      /**
       * 目标动作走客户端 `remote.goals`（ui-goal 用的同一个命名空间）：
       * `get/pause/resume/clear(sessionId, ref)`，ref = { id, revision }。
       * 失败只记录在分区内，不抛给渲染（抛了就整块面板被错误边界接住）。
       */
      const runGoalAction = function (verb) {
        if (!goalsFace || !props.sessionId || !snapshot) return;
        const ref = { id: snapshot.id, revision: snapshot.revision };
        try {
          const result = goalsFace[verb](props.sessionId, ref);
          if (result && typeof result.catch === 'function') {
            result.catch(function (error) {
              setActionError(String((error && error.message) || error));
            });
          }
        } catch (error) {
          setActionError(String((error && error.message) || error));
        }
      };
      const actionButton = function (verb, labelKey, icon) {
        const enabled = Boolean(goalsFace && props.sessionId);
        return h(
          'button',
          {
            type: 'button',
            'data-goal-action': verb,
            'aria-label': T(labelKey),
            title: T(labelKey),
            disabled: !enabled,
            onClick: function (event) {
              event.stopPropagation();
              runGoalAction(verb);
            },
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              padding: 0,
              border: 0,
              borderRadius: 6,
              background: 'transparent',
              color: enabled ? TOKEN.muted : TOKEN.idle,
              cursor: enabled ? 'pointer' : 'default',
            },
          },
          h(icon, { size: 13 }),
        );
      };
      const blocked =
        snapshot && snapshot.blockedReason && typeof snapshot.blockedReason.message === 'string'
          ? snapshot.blockedReason.message
          : null;

      return h(
        Section,
        {
          id: 'goal',
          title: T('section.goal'),
          icon: GoalIcon,
          defaultOpen: true,
          separated: props.separated,
          trailing: h(
            'span',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
            h(
              'span',
              { 'data-goal-elapsed-seconds': elapsed, style: { fontVariantNumeric: 'tabular-nums' } },
              formatSeconds(T, elapsed),
            ),
            h('span', null, '·'),
            h('span', { 'data-goal-status': phase, style: { color: goalStatusColor(phase) } }, goalStatusWord(T, phase)),
            phase === 'active' ? actionButton('pause', 'goal.pause', PauseIcon) : null,
            phase === 'paused' ? actionButton('resume', 'goal.resume', PlayIcon) : null,
            h('span', { style: { flex: 'none', display: 'inline-flex' } }, actionButton('clear', 'goal.clear', StopIcon)),
          ),
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 8,
            },
          },
          h('span', { key: 'i', style: { display: 'flex', color: TOKEN.muted, marginTop: 1 } }, h(GoalIcon, { size: 14 })),
          h(
            'span',
            { key: 'o', title: goalTitle(goal) || '', style: Object.assign({}, rowTextStyle, clampLines(3), { fontWeight: 500 }) },
            goalTitle(goal) || T('goal.untitled'),
          ),
        ),
        rounds.max > 0
          ? h(
              'div',
              {
                'data-goal-rounds': rounds.started + '/' + rounds.max,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 8,
                },
              },
              h(
                'span',
                { style: Object.assign({}, metaTextStyle, { display: 'flex' }) },
                '#' + rounds.started,
              ),
              h(
                'span',
                { style: Object.assign({}, rowTextStyle, { color: TOKEN.muted }) },
                T('goal.round', { started: rounds.started, max: rounds.max }),
              ),
            )
          : null,
        blocked
          ? h(
              'div',
              {
                'data-goal-blocked': 'true',
                style: {
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 8,
                },
              },
              h('span', { style: { display: 'flex', color: TOKEN.warn, marginTop: 1 } }, h(CircleIcon, { size: 14 })),
              h('span', { style: Object.assign({}, rowTextStyle, { color: TOKEN.warn }) }, blocked),
            )
          : null,
        actionError
          ? h(
              'div',
              { 'data-goal-error': actionError, style: { padding: '6px 8px', color: TOKEN.error, fontSize: FONT_SMALL, lineHeight: LEAD_SMALL } },
              T('goal.actionFailed', { error: actionError }),
            )
          : null,
      );
    }

    function ProgressSection(props) {
      const T = props.T;
      const todos = props.todos;
      const counts = todoCounts(todos);
      const [expanded, setExpanded] = useState({});
      const window = todoFocusWindow(todos);
      const toggle = function (group) {
        setExpanded(function (current) {
          const next = Object.assign({}, current);
          if (next[group]) delete next[group];
          else next[group] = true;
          return next;
        });
      };
      const fold = function (group, key, labelKey, items) {
        return h(FoldRow, {
          key: key,
          group: group,
          expanded: expanded[group] === true,
          label: T(labelKey, { count: items.length }),
          ariaLabel: T('todo.fold.aria', { count: items.length }),
          items: items,
          onClick: function () {
            toggle(group);
          },
        });
      };
      const rowsFor = function (items, prefix) {
        return items.map(function (item, index) {
          return h(TodoRow, { key: prefix + index, item: item });
        });
      };

      let rows = [];
      if (!window) {
        rows = rowsFor(todos, 'a');
      } else {
        const before = todos.slice(0, window.start);
        const focus = todos.slice(window.start, window.end);
        const after = todos.slice(window.end);
        // ZCode 的四种折叠：已完成的、前面其余的、待处理的、后面其余的。
        const completedBefore = before.filter(function (item) {
          return item.status === 'completed';
        });
        const otherBefore = before.filter(function (item) {
          return item.status !== 'completed';
        });
        const waitingAfter = after.filter(function (item) {
          return item.status === 'pending';
        });
        const otherAfter = after.filter(function (item) {
          return item.status !== 'pending';
        });
        if (completedBefore.length > 0) {
          rows = rows.concat(
            expanded['completed-before']
              ? rowsFor(completedBefore, 'cb')
              : [fold('completed-before', 'f-cb', 'todo.fold.completed', completedBefore)],
          );
        }
        if (otherBefore.length > 0) {
          rows = rows.concat(
            expanded['earlier-before']
              ? rowsFor(otherBefore, 'eb')
              : [fold('earlier-before', 'f-eb', 'todo.fold.earlier', otherBefore)],
          );
        }
        rows = rows.concat(rowsFor(focus, 'f'));
        if (waitingAfter.length > 0) {
          rows = rows.concat(
            expanded['waiting-after']
              ? rowsFor(waitingAfter, 'wa')
              : [fold('waiting-after', 'f-wa', 'todo.fold.waiting', waitingAfter)],
          );
        }
        if (otherAfter.length > 0) {
          rows = rows.concat(
            expanded['later-after']
              ? rowsFor(otherAfter, 'la')
              : [fold('later-after', 'f-la', 'todo.fold.later', otherAfter)],
          );
        }
      }

      return h(
        Section,
        {
          id: 'plan',
          title: T('section.progress'),
          icon: ListIcon,
          defaultOpen: true,
          separated: props.separated,
          trailing: h(
            'span',
            { 'data-todo-counts': counts.completed + '/' + counts.total, style: { fontVariantNumeric: 'tabular-nums' } },
            counts.completed + '/' + counts.total,
          ),
        },
        h('ul', { style: { margin: 0, padding: 0, display: 'flex', flexDirection: 'column' } }, rows),
      );
    }

    // ------------------------------- ZCode 模型层（1:1 移植，见 zcode-model.js）
    // 优先级链、计数、折叠窗口、降级行与 Stop 判据全部来自 ZCode 原版实现（见文件头注入块）；
    // 只有「数据入口」是本插件自己的适配（adaptToZCodeInput）。
    // 注入块里的 buildConversationStatusPanelModel / resolveConversationStatusPanelVariant /
    // shouldUseConversationStatusPanelInlineLayout / getConversationStatusPanelOffsetClassName /
    // workflowRunOpenTarget 已是本闭包内的函数声明，这里直接用，不再解构。

    /**
     * DSH 数据 → ZCode 模型输入。这是移植层里**唯一**由本包自己的部分：
     * ZCode 的输入类型是它自己的协议（PlanState / BackgroundWorkSummary /
     * RunningSubagentSummary / WorkflowRunState / GoalState / ToolCallRow / GitRepositorySummary），
     * DSH 侧来自会话投影与 jobs roster。这里只做**形状对齐**，不做任何显示规则判断——
     * 判断规则全部留在 ZCode 原版函数里。
     */
    function adaptToZCodeInput(options) {
      const {
        todos,
        goal,
        agents,
        jobs,
        gitSummary = null,
        gitDirtyFileCount = 0,
        gitWorktreeChangeSummary = null,
      } = options;

      // todos 投影 → ZCode PlanState（status 词表相同：pending / in_progress / completed）
      const plan =
        todos.length > 0
          ? {
              items: todos.map(function (item) {
                return {
                  id: item.content,
                  content: item.content,
                  status: item.status,
                };
              }),
              updatedAt: 0,
            }
          : null;

      // jobs roster → ZCode BackgroundWorkSummary（status 词表映射见 jobToZCodeWork）
      const backgroundWorks = jobs.map(jobToZCodeWork);

      // subagentCatalog → ZCode RunningSubagentSummary
      // ZCode 的 Agent 分区只列「运行中」的子代理；目录里已结束的子会话不进 Agent 分区
      // （它的已结束计数由页脚目录入口承担，DSH 没有对应页签，见 README 已知限制）。
      const runningSubagents = agents.map(function (agent) {
        return {
          childSessionId: String(agent.id),
          subagentType: typeof agent.label === 'string' && agent.label.trim() ? agent.label.trim() : 'subagent',
          title:
            typeof agent.label === 'string' && agent.label.trim()
              ? agent.label.trim()
              : String(agent.id),
          status: 'running',
        };
      });

      // 目标：ZCode 期望扁平的 GoalState；DSH 的 goal 投影是嵌套的，这里只做**字段搬运**，
      // phase 词表映射见 goalToZCodeGoal。ZCode 的 phase 是 6 值语义
      // （active/paused/verifying/verified/notSatisfied/failed），DSH 是 4 值
      // （active/paused/blocked/complete），映射在 goalToZCodeGoal。
      const goalState = goalToZCodeGoal(goal);

      return {
        isOfficeMode: false,
        gitSummary,
        gitDirtyFileCount,
        gitWorktreeChangeSummary,
        goal: goalState,
        // DSH 没有 ExitPlanMode 记录投影：ZCode 的「计划」分区输入恒缺省。
        sessionPlans: undefined,
        workspacePath: undefined,
        plan,
        backgroundWorks,
        runningSubagents,
        // DSH 没有独立的 workflowRun 投影；workflow 以 job 形式出现在 backgroundWorks 里，
        // 由 ZCode 的 buildRunningWorkflowRuns 走「work 有 run 无」的降级行分支产出运行中的行。
        workflowRuns: undefined,
      };
    }

    function jobToZCodeWork(job) {
      return {
        workId: job.id,
        // ZCode 的 kind 只有 bash / subagent / workflow 三种；DSH 的 jobs 服务还有
        // terminal / pwsh 等扩展 kind，一律折进 bash（ZCode 的 Terminals 分区按 bash 渲染）。
        kind: job.kind === 'workflow' ? 'workflow' : job.kind === 'subagent' ? 'subagent' : 'bash',
        title: job.label || job.id,
        // ZCode 的 status 是 running / resultPending / failed / cancelled；
        // DSH 的 running / stopping / completed / killed / failed 按语义对映。
        status:
          job.status === 'running'
            ? 'running'
            : job.status === 'stopping'
              ? 'resultPending'
              : job.status === 'completed'
                ? 'resultPending'
                : job.status === 'killed'
                  ? 'cancelled'
                  : 'failed',
        startedAt: typeof job.startedAt === 'number' ? job.startedAt : 0,
        finishedAt: typeof job.finishedAt === 'number' ? job.finishedAt : undefined,
        cancellable: jobIsLive(job.status),
        anchorRowId: null,
        childSessionId: job.kind === 'subagent' ? job.label || undefined : undefined,
        // 步骤计数进 progress（ZCode 的 workflow 行读 progress 之外还读 run 的 nodes；
        // 降级行没有 run，所以文案只能来自 work 自己的字段）。
        progress: job.progress,
      };
    }

    function goalToZCodeGoal(projection) {
      const snapshot = goalSnapshot(projection);
      if (!snapshot) return null;
      const phase = snapshot.phase;
      return {
        targetId: String(snapshot.id),
        objective: typeof snapshot.objective === 'string' ? snapshot.objective : '',
        summaryTitle: null,
        timeUsedSeconds:
          projection && typeof projection.createdAt === 'number' && typeof projection.updatedAt === 'number'
            ? Math.max(0, Math.floor((projection.updatedAt - projection.createdAt) / 1000))
            : 0,
        activeRunStartedAtMs: null,
        // ZCode phase（6 值）← DSH phase（4 值）：
        //   active → active；paused → paused；blocked → notSatisfied（"还没达成"）；
        //   complete → verified。verifying / failed 在 DSH 没有对应态，按最近的语义落。
        phase:
          phase === 'active'
            ? 'active'
            : phase === 'paused'
              ? 'paused'
              : phase === 'blocked'
                ? 'notSatisfied'
                : phase === 'complete'
                  ? 'verified'
                  : 'failed',
        iteration: projection && typeof projection.roundsStarted === 'number' ? projection.roundsStarted : 0,
        verifications: [],
        iterations: [],
      };
    }

    // ------------------------------------------------------- 后台任务（jobs）
    /**
     * 客户端 `jobs` 服务面。apply 里用 `ctx.inject(['jobs'], …)` 取得——
     * 用可选注入而不是硬 `inject`，这样即使某个 profile 没有 jobs 服务，
     * 也只是少了「后台」分区，不会整块面板不激活。
     * 形状实测自 ui-jobs（`inject: ['jobs','slots','locale']`）：
     * `state.getSnapshot()/subscribe`、`watchRows(sessionId)`、`observe`、`kill`。
     */
    let jobsFace = null;
    /** 客户端 sidebarRight 服务面（打开右侧资源页签）。缺失时子代理行降级为不可点。 */
    let sidebarRightFace = null;
    /** 与 ui-subagent 一致的子会话聊天资源地址前缀（`SUBAGENT_CHAT_ADDRESS`）。 */
    const SUBAGENT_CHAT_ADDRESS = 'dsh-resource://subagentchat/session/';

    const JOB_STATUS_KEY = {
      running: 'job.status.running',
      stopping: 'job.status.stopping',
      completed: 'job.status.completed',
      killed: 'job.status.killed',
      failed: 'job.status.failed',
    };

    function jobStatusWord(T, status) {
      return T(JOB_STATUS_KEY[status] || 'goal.status.unknown');
    }

    function jobIsLive(status) {
      return status === 'running' || status === 'stopping';
    }

    function jobStatusColor(status) {
      if (status === 'completed') return TOKEN.success;
      if (status === 'failed') return TOKEN.error;
      return jobIsLive(status) ? TOKEN.warn : TOKEN.muted;
    }

    /** 状态点形状对齐宿主 StateDot：失败实心带环、被停止空心、其余实心。 */
    function jobDotShape(status) {
      if (status === 'failed') return 'ring';
      if (status === 'killed') return 'hollow';
      return 'filled';
    }

    /**
     * 本会话的后台任务行 + 逐任务观测输出。`watchRows` 在挂载期间保持 roster 最新
     * （服务内部按引用计数），卸载即停。`observed[jobId]` 只有在某行调用过
     * `observe` 之后才有值（`ObservedJob = { text, gapBefore, streaming, error? }`）。
     */
    function useJobsState(sessionId) {
      const [snapshot, setSnapshot] = useState(function () {
        return jobsFace ? jobsFace.state.getSnapshot() : null;
      });
      useEffect(function () {
        if (!jobsFace) return undefined;
        setSnapshot(jobsFace.state.getSnapshot());
        return jobsFace.state.subscribe(function () {
          setSnapshot(jobsFace.state.getSnapshot());
        });
      }, []);
      useEffect(function () {
        if (!jobsFace || !sessionId) return undefined;
        return jobsFace.watchRows(sessionId);
      }, [sessionId]);
      const rows =
        snapshot && sessionId && snapshot.rows && Array.isArray(snapshot.rows[sessionId])
          ? snapshot.rows[sessionId]
          : [];
      return { rows: rows, observed: snapshot ? snapshot.observed : null };
    }

    /**
     * 一行后台任务：点击展开该任务的输出（`jobs.observe` 在展开期间保持观测，
     * 收起即停，服务端按引用计数）。终态行若留有输出也照样可看——与宿主的
     * "live 或 output.total > 0 才可观测" 判据一致。
     */
    function JobRow(props) {
      const T = props.T;
      const job = props.job;
      const sessionId = props.sessionId;
      const observed = props.observed;
      const [open, setOpen] = useState(false);
      const [hover, setHover] = useState(false);
      const live = jobIsLive(job.status);
      const now = useNowTicker(live);
      // 与宿主同判据：live 的任务、或留下过输出的终态任务，都可以观测。
      const observable = Boolean(jobsFace && sessionId && (live || (job.output && job.output.total > 0)));
      /** 只有运行中/停止中的任务可以停（ZCode 的 RunningWorkCancelButton 同判据）。 */
      const canStop = Boolean(jobsFace && sessionId && live);
      const [stopError, setStopError] = useState(null);

      useEffect(
        function () {
          if (!open || !observable) return undefined;
          return jobsFace.observe(sessionId, job.id);
        },
        [open, observable, sessionId, job.id],
      );

      const end = live ? now : typeof job.finishedAt === 'number' ? job.finishedAt : now;
      const startedAt = typeof job.startedAt === 'number' ? job.startedAt : end;
      const elapsed = Math.max(0, Math.floor((end - startedAt) / 1000));
      const view = observed && observed[job.id] ? observed[job.id] : null;

      const head = function () {
        return h(
          'span',
          { style: { display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: '1 1 auto' } },
          h(
            'span',
            { style: { display: 'flex', marginTop: 6, color: jobStatusColor(job.status) } },
            h('span', { style: statusDotStyle(jobStatusColor(job.status), jobDotShape(job.status)) }),
          ),
          h(
            'span',
            { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' } },
            h(
              'span',
              {
                title: job.label || job.id,
                style: Object.assign({}, rowTextStyle, clampLines(2)),
              },
              job.label || job.id,
            ),
            h(
              'span',
              { style: Object.assign({}, metaTextStyle, { display: 'flex', gap: 6, flexWrap: 'wrap' }) },
              h('span', null, String(job.kind)),
              h('span', { style: { color: jobStatusColor(job.status) } }, jobStatusWord(T, job.status)),
              h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, formatSeconds(T, elapsed)),
              job.progress
                ? h(
                    'span',
                    {
                      title: String(job.progress),
                      style: { maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    },
                    String(job.progress),
                  )
                : null,
            ),
          ),
        );
      };

      const output = open
        ? h(
            'div',
            {
              'data-job-output': job.id,
              style: {
                marginTop: 4,
                padding: 8,
                borderRadius: 8,
                background: 'var(--dsw-alias-bg-layer-2, transparent)',
                boxSizing: 'border-box',
                minWidth: 0,
              },
            },
            h(
              'pre',
              {
                style: {
                  margin: 0,
                  maxHeight: '10rem',
                  overflow: 'auto',
                  scrollbarGutter: 'stable',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: FONT_SMALL,
                  lineHeight: LEAD_SMALL,
                  color: TOKEN.muted,
                },
              },
              view
                ? (view.gapBefore ? T('job.output.gap') + '\n' : '') + (view.text || T('job.output.empty'))
                : T('job.output.loading'),
            ),
            h(
              'span',
              { style: Object.assign({}, metaTextStyle, { display: 'flex', gap: 8, marginTop: 4 }) },
              view && view.streaming ? h('span', { style: { color: TOKEN.warn } }, T('job.output.streaming')) : null,
              view && view.error ? h('span', { style: { color: TOKEN.error } }, view.error) : null,
            ),
          )
        : null;

      return h(
        'li',
        {
          'data-job-id': job.id,
          'data-job-kind': job.kind,
          'data-job-status': job.status,
          style: { listStyle: 'none', minWidth: 0 },
        },
        h(
          'button',
          {
            type: 'button',
            disabled: !observable,
            'aria-expanded': observable ? open : undefined,
            'aria-label': observable
              ? T(open ? 'job.output.close' : 'job.output.open', { label: job.label || job.id })
              : job.label || job.id,
            onClick: function () {
              if (observable) {
                setOpen(function (value) {
                  return !value;
                });
              }
            },
            onMouseEnter: function () {
              setHover(true);
            },
            onMouseLeave: function () {
              setHover(false);
            },
            style: Object.assign({}, clickableRowStyle, {
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '6px 8px',
              background: observable && hover ? 'var(--dsw-alias-interactive-bg-hover, transparent)' : 'transparent',
              cursor: observable ? 'pointer' : 'default',
            }),
          },
          head(),
          observable ? h(ChevronDownIcon, { size: 14 }) : null,
        ),
        // ZCode 的 RunningWorkCancelButton：只有运行中的后台行才有停止。
        canStop
          ? h(
              'button',
              {
                type: 'button',
                'data-job-stop': job.id,
                'aria-label': T('job.stop', { label: job.label || job.id }),
                title: T('job.stop', { label: job.label || job.id }),
                onClick: function (event) {
                  event.stopPropagation();
                  try {
                    const result = jobsFace.kill(sessionId, job.id);
                    if (result && typeof result.catch === 'function') {
                      result.catch(function (error) {
                        setStopError(String((error && error.message) || error));
                      });
                    }
                  } catch (error) {
                    setStopError(String((error && error.message) || error));
                  }
                },
                style: Object.assign({}, clickableRowStyle, {
                  flex: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  width: 'auto',
                  height: 22,
                  padding: '0 6px',
                  fontSize: FONT_SMALL,
                  color: TOKEN.error,
                  background: 'transparent',
                }),
              },
              h(StopIcon, { size: 11 }),
              T('job.stop.short'),
            )
          : null,
        stopError
          ? h('span', { style: Object.assign({}, metaTextStyle, { color: TOKEN.error }) }, T('job.killFailed', { error: stopError }))
          : null,
        output,
      );
    }

    /** 后台/工作流分区：同一套行渲染，靠 id/title/icon/defaultOpen 参数化。 */
    function JobSection(props) {
      const T = props.T;
      const jobs = props.jobs;
      const liveCount = jobs.filter(function (job) {
        return jobIsLive(job.status);
      }).length;
      return h(
        Section,
        {
          id: props.id || 'background',
          title: T(props.titleKey || 'section.background'),
          icon: props.icon || TerminalIcon,
          defaultOpen: props.defaultOpen === true,
          separated: props.separated,
          trailing: h(
            'span',
            { 'data-background-count': liveCount, style: { fontVariantNumeric: 'tabular-nums' } },
            liveCount > 0
              ? T(liveCount === 1 ? 'job.count.live.one' : 'job.count.live.other', { count: liveCount })
              : String(jobs.length),
          ),
        },
        h(
          'ul',
          { style: { margin: 0, padding: 0, display: 'flex', flexDirection: 'column' } },
          jobs.map(function (job) {
            return h(JobRow, {
              key: job.id,
              T: T,
              job: job,
              observed: props.observed,
              sessionId: props.sessionId,
            });
          }),
        ),
      );
    }

    // ------------------------------------------------------------ 智能体（子代理）
    /**
     * `subagentCatalog` 投影：`SubagentCatalogEntry = { id, createdAt, mode, label? }`。
     * 它只承载"发现身份"（label / 生命周期模式），**不含运行状态**——运行状态在
     * jobs roster 的 `kind` 那一侧，所以这里只如实显示身份与模式，不编造状态。
     *
     * 可点击：点击行打开该子会话。地址格式与 `ui-subagent` 的
     * `subagentChatAddress()` 一致（`dsh-resource://subagentchat/session/<child>?parent=…&mode=…`），
     * 由 `ctx.sidebarRight.openResource(address)` 打开右侧会话页签。
     */
    function subagentChatAddress(childSessionId, parentSessionId, mode) {
      return (
        SUBAGENT_CHAT_ADDRESS +
        encodeURIComponent(String(childSessionId)) +
        '?parent=' +
        encodeURIComponent(String(parentSessionId)) +
        '&mode=' +
        encodeURIComponent(String(mode))
      );
    }

    function SubagentSection(props) {
      const T = props.T;
      const agents = props.agents;
      const canOpen = Boolean(sidebarRightFace && props.parentSessionId);
      return h(
        Section,
        {
          id: 'agents',
          title: T('section.agents'),
          icon: BotIcon,
          defaultOpen: props.defaultOpen,
          separated: props.separated,
          trailing: h(
            'span',
            { 'data-agent-count': agents.length, style: { fontVariantNumeric: 'tabular-nums' } },
            String(agents.length),
          ),
        },
        h(
          'ul',
          { style: { margin: 0, padding: 0, display: 'flex', flexDirection: 'column' } },
          agents.map(function (agent) {
            return h(SubagentRow, {
              key: String(agent.id),
              T: T,
              agent: agent,
              canOpen: canOpen,
              parentSessionId: props.parentSessionId,
            });
          }),
        ),
      );
    }

    function SubagentRow(props) {
      const T = props.T;
      const agent = props.agent;
      const [hover, setHover] = useState(false);
      const label =
        typeof agent.label === 'string' && agent.label.trim() ? agent.label.trim() : String(agent.id);
      const modeWord =
        agent.mode === 'continuable'
          ? T('agent.mode.continuable')
          : agent.mode === 'one-shot'
            ? T('agent.mode.oneShot')
            : T('agent.mode.unknown');
      const openable = Boolean(props.canOpen);
      return h(
        'li',
        {
          'data-child-session-id': String(agent.id),
          'data-agent-mode': agent.mode,
          style: { listStyle: 'none', minWidth: 0 },
        },
        h(
          'button',
          {
            type: 'button',
            disabled: !openable,
            'aria-label': openable ? T('agent.open', { label: label }) : label,
            onClick: function () {
              if (!openable) return;
              // 面板本身只在会话视图里挂载，所以右侧栏一定有会话座位；
              // 仍然兜一层：openResource 在无座位时按契约会抛，不能让一次点击掀掉整个面板。
              try {
                sidebarRightFace.openResource(
                  subagentChatAddress(agent.id, props.parentSessionId, agent.mode),
                );
              } catch (error) {
                console.error('[dsh-session-status-panel] open subagent session failed:', error);
              }
            },
            onMouseEnter: function () {
              setHover(true);
            },
            onMouseLeave: function () {
              setHover(false);
            },
            style: Object.assign({}, clickableRowStyle, {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              background: openable && hover ? 'var(--dsw-alias-interactive-bg-hover, transparent)' : 'transparent',
              cursor: openable ? 'pointer' : 'default',
            }),
          },
          h('span', { style: { display: 'flex', color: TOKEN.muted } }, h(BotIcon, { size: 14 })),
          h(
            'span',
            {
              title: label,
              style: Object.assign({}, rowTextStyle, {
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }),
            },
            label,
          ),
          h('span', { style: Object.assign({}, metaTextStyle, { flex: 'none' }) }, modeWord),
          openable
            ? h('span', { style: { display: 'flex', flex: 'none', color: TOKEN.muted, opacity: 0.6 } }, h(ChevronRightIcon, { size: 14 }))
            : null,
        ),
      );
    }

    const PANEL_REF = { current: null };

    /** 面板表面（`aside`）的真实视口矩形。 */
    function panelRect() {
      return PANEL_REF.current && typeof PANEL_REF.current.getBoundingClientRect === 'function'
        ? PANEL_REF.current.getBoundingClientRect()
        : null;
    }

    /*
     * 浮层坐标：面板表面带 `backdrop-filter: blur(40px)`（宿主菜单面语汇），而
     * backdrop-filter 会让它成为 fixed/absolute 后代的**包含块**；同时 aside 自己是
     * `position: static`，所以这些浮层的包含块实际是外层那个 `position: fixed` 的锚点
     * （锚点只有面板一个孩子，两者矩形相同）。宿主 Radix 菜单不受影响是因为它 portal 到
     * document.body；插件半区不能 import react-dom，所以自己做换算。
     *
     * 下面三个函数都写成**纯函数**（显式吃矩形与视口尺寸），以便被脚本直接单元测试：
     *   clampTop / clampRightEdge —— 在视口里选一个不越界的值；
     *   panelOffset —— 把"视口坐标下的边缘位置"换算成面板空间偏移。
     * 统一约定：edge = { top: 视口 y, rightEdge: 视口 x }（rightEdge 是绝对 x，不是距离）。
     */

    /** 在视口里选一个避开上下边界的 top。 */
    function clampTop(desired, height, viewportHeight) {
      const max = Math.max(8, viewportHeight - height - 8);
      return Math.max(8, Math.min(desired, max));
    }

    /** 在视口里选一个避开左右边界的**右缘** x（菜单/预览卡都以右缘对齐）。 */
    function clampRightEdge(desired, width, viewportWidth) {
      const min = 8 + width;
      const max = Math.max(min, viewportWidth - 8);
      return Math.max(min, Math.min(desired, max));
    }

    /** 视口坐标 → 面板空间偏移（top 相对面板顶、right 相对面板右缘）。 */
    function panelOffset(panelBox, edge) {
      if (!panelBox) return { top: 0, right: 0 };
      return { top: edge.top - panelBox.top, right: panelBox.right - edge.rightEdge };
    }

    // ------------------------------------------------------ 目标动作与展开策略
    /** 客户端 `remote.goals` 面（暂停/继续/清除）。缺失时目标分区只剩只读展示。 */
    let goalsFace = null;
    /** 展开策略在 localStorage 的键。 */
    const MODE_KEY = 'dsh-session-status-panel:display-mode';

    function readDisplayMode() {
      try {
        const value = window.localStorage.getItem(MODE_KEY);
        return value === 'expanded' || value === 'collapsed' ? value : 'auto';
      } catch (error) {
        return 'auto';
      }
    }

    function writeDisplayMode(mode) {
      try {
        if (mode === 'auto') window.localStorage.removeItem(MODE_KEY);
        else window.localStorage.setItem(MODE_KEY, mode);
      } catch (error) {
        /* 无 localStorage 时静默降级为会话内状态 */
      }
    }

    const MENU_WIDTH = 208;
    /**
     * 展开策略菜单（ZCode 的 EllipsisIcon 菜单）。ZCode 只发了一个「自动展开」项，
     * 这里把它原本设计的三态补全：自动（默认收起）/ 始终展开 / 始终收起，并持久化。
     * 菜单不能 portal（插件半区不 import ReactDOM），而面板的 backdrop-filter 又会成为
     * fixed/absolute 的包含块，所以坐标先在视口里算、再由 toPanelSpace() 换算进面板空间。
     */
    function DisplayModeMenu(props) {
      const T = props.T;
      const [open, setOpen] = useState(false);
      const [anchor, setAnchor] = useState(null);
      const container = useRef(null);
      useEffect(
        function () {
          if (!open) return undefined;
          const onPointerDown = function (event) {
            if (container.current && !container.current.contains(event.target)) setOpen(false);
          };
          document.addEventListener('pointerdown', onPointerDown, true);
          return function () {
            document.removeEventListener('pointerdown', onPointerDown, true);
          };
        },
        [open],
      );
      const MODES = ['auto', 'expanded', 'collapsed'];
      return h(
        'span',
        { ref: container, style: { display: 'inline-flex' } },
        h(
          'button',
          {
            type: 'button',
            'data-display-mode-trigger': 'true',
            'aria-label': T('panel.mode'),
            'aria-expanded': open,
            title: T('panel.mode'),
            onClick: function (event) {
              const rect = event.currentTarget.getBoundingClientRect();
              setAnchor(
                panelOffset(panelRect(), {
                  // 菜单右缘与按钮右缘对齐、落在按钮下方 4px。
                  top: clampTop(rect.bottom + 4, 160, window.innerHeight),
                  rightEdge: clampRightEdge(rect.right, MENU_WIDTH, window.innerWidth),
                }),
              );
              setOpen(function (value) {
                return !value;
              });
            },
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              padding: 0,
              border: 0,
              borderRadius: 6,
              background: 'transparent',
              color: TOKEN.muted,
              cursor: 'pointer',
            },
          },
          h(EllipsisIcon, { size: 14 }),
        ),
        open && anchor
          ? h(
              'div',
              {
                'data-display-mode-menu': 'true',
                style: {
                  // 面板空间坐标（由 toPanelSpace 换算）；面板的 backdrop-filter 是包含块，
                  // 直接写视口坐标会整体偏移一个面板矩形。
                  position: 'absolute',
                  top: anchor.top,
                  right: anchor.right,
                  zIndex: 1102,
                  width: MENU_WIDTH,
                  padding: 4,
                  boxSizing: 'border-box',
                  background: 'var(--dsw-specific-menu, ' + TOKEN.surface + ')',
                  border: 0,
                  borderRadius: 'var(--dsw-radius-lg, 12px)',
                  boxShadow: 'var(--dsw-elevation-prominent, 0 6px 24px rgba(0,0,0,0.18))',
                  backdropFilter: 'var(--dsw-menu-backdrop-filter, none)',
                  color: TOKEN.text,
                },
              },
              MODES.map(function (value) {
                const selected = props.mode === value;
                return h(
                  'button',
                  {
                    key: value,
                    type: 'button',
                    role: 'menuitemradio',
                    'aria-checked': selected,
                    'data-display-mode-item': value,
                    onClick: function () {
                      props.onChange(value);
                      setOpen(false);
                    },
                    style: Object.assign({}, clickableRowStyle, {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 8px',
                      background: selected ? TOKEN.hover : 'transparent',
                    }),
                  },
                  h('span', { style: { width: 12, flex: 'none', color: TOKEN.brand } }, selected ? '✓' : ''),
                  h('span', { style: { minWidth: 0, whiteSpace: 'nowrap' } }, T('panel.mode.' + value)),
                );
              }),
            )
          : null,
      );
    }

    // ----------------------------------------------------------- 主组件
    /**
     * 内部错误边界。为什么必须有：slot 条目在渲染抛错时会被框架"摘除"（abdicate），
     * 于是本插件遮蔽的宿主 todo dock 会顶回来——表现就是"我们的面板不见了、宿主那个又出现了"。
     * 有了这道边界，崩溃留在面板内部显示成一行错误文本，条目本身不会掉。
     * `React.Component` 理论上一定在（模块表给的是真 React）；仍然做存在性判断，
     * 免得万一缺失时 `extends undefined` 在模块求值期就把整个插件带崩。
     */
    const ReactBaseComponent = React.Component;
    const PanelErrorBoundary =
      typeof ReactBaseComponent === 'function'
        ? class PanelErrorBoundary extends ReactBaseComponent {
            constructor(props) {
              super(props);
              this.state = { error: null };
            }

            static getDerivedStateFromError(error) {
              return { error: error };
            }

            componentDidCatch(error) {
              console.error('[dsh-session-status-panel] ' + (this.props.label || 'panel') + ' crashed:', error);
            }

            render() {
              if (this.state.error) {
                const error = this.state.error;
                return h(
                  'div',
                  {
                    'data-panel-error': String(this.props.label || 'panel'),
                    style: {
                      pointerEvents: 'auto',
                      maxWidth: SHELL_WIDTH,
                      boxSizing: 'border-box',
                      padding: '6px 8px',
                      borderRadius: 8,
                      background: 'var(--dsw-specific-menu, ' + TOKEN.surface + ')',
                      color: TOKEN.error,
                      fontSize: FONT_SMALL,
                      lineHeight: LEAD_SMALL,
                    },
                  },
                  '[' + String(this.props.label || 'panel') + '] ',
                  String((error && error.message) || error),
                );
              }
              return this.props.children;
            }
          }
        : function PanelErrorBoundaryPassthrough(props) {
            return props.children;
          };

    /** 薄壳：把真正的实现包进错误边界，任何内部崩溃都不再摘除条目。 */
    function StatusPanel(props) {
      return h(PanelErrorBoundary, { label: 'session-status-panel' }, h(StatusPanelBody, props));
    }

    function StatusPanelBody(props) {
      const useProjection = props.useProjection;
      // locale 服务在场时用框架注入的 t（跟随语言切换重渲染），否则退回本包 zh 字典。
      const t = props.t;
      const T = function (key, params) {
        return translate(ZH, t, key, params);
      };
      const todosProjection = useProjection('todos');
      const goalProjection = useProjection('goal');
      const todos = useMemo(
        function () {
          return Array.isArray(todosProjection) ? todosProjection : [];
        },
        [todosProjection],
      );
      const goal = goalProjection || null;
      const agentsProjection = useProjection('subagentCatalog');
      const agents = useMemo(
        function () {
          return Array.isArray(agentsProjection) ? agentsProjection : [];
        },
        [agentsProjection],
      );
      const jobsState = useJobsState(props.sessionId);
      const jobs = jobsState.rows;
      const liveJobCount = jobs.filter(function (job) {
        return jobIsLive(job.status);
      }).length;
      /** ZCode 把工作流单列一个分区；这里按 job.kind 拆开，其余留在「后台」。 */
      const workflowJobs = jobs.filter(function (job) {
        return job.kind === 'workflow';
      });
      const backgroundJobs = jobs.filter(function (job) {
        return job.kind !== 'workflow';
      });
      const [mode, setMode] = useState(readDisplayMode);
      const [collapsed, setCollapsed] = useState(readDisplayMode() !== 'expanded');
      const [capsuleHover, setCapsuleHover] = useState(false);
      /** 面板表面的 ref：浮层坐标换算要用它测矩形。 */
      const panelRef = useRef(null);

      const changeMode = useCallback(function (next) {
        setMode(next);
        writeDisplayMode(next);
        if (next === 'expanded') setCollapsed(false);
        if (next === 'collapsed') setCollapsed(true);
      }, []);

      /*
       * 手动开合 = 写 override（与 ZCode 同语义：胶囊点击 → variant 'panel'，
       * 收起按钮 → variant 'mini'，而不是切回'自动'）。
       * 早先的写法是「点胶囊只改本地 collapsed」，而 isCollapsed 仍由 mode 派生
       * → mode 停在 'collapsed' 时面板锁在收起态，点了没反应。
       * 这样改之后「始终收起 / 始终展开」回归"默认态"语义，菜单里随时能回'自动'。
       */
      const collapse = useCallback(
        function () {
          setCollapsed(true);
          changeMode('collapsed');
        },
        [changeMode],
      );
      const expand = useCallback(
        function () {
          setCollapsed(false);
          changeMode('expanded');
        },
        [changeMode],
      );

      const currentTodo = findCurrentTodo(todos);
      const completedTodo = findCompletedTodo(todos);
      const title = goalTitle(goal);

      /*
       * 胶囊优先级链（ZCode 顺序，裁剪到 DSH 客户端槽位真能读到的数据）：
       *   当前待办 → 未完成目标 → 已完成目标 → 最近完成的待办。
       * ZCode 链里还有「计划计数」一支，但它在 DSH 不可达：只要能走到那里，
       * todos 非空却又既无 in_progress/pending（被第 1 支接走）又无 completed
       * （被第 4 支接走）——不存在这种状态，所以不写死代码。
       */
      let metric = null;
      if (currentTodo) {
        metric = { icon: ArrowRightIcon, color: TOKEN.text, label: currentTodo.content, value: null };
      } else if (title && goalIsOpen(goal)) {
        metric = { icon: GoalIcon, color: TOKEN.text, label: title, value: null };
      } else if (title) {
        metric = { icon: GoalIcon, color: TOKEN.success, label: title, value: null };
      } else if (completedTodo) {
        metric = { icon: CheckIcon, color: TOKEN.success, label: completedTodo.content, value: null };
      } else if (liveJobCount > 0) {
        // 实时活动只在没有 Goal/Todo 等主状态时兜底（ZCode 同一条产品规则）。
        metric = {
          icon: TerminalIcon,
          color: TOKEN.warn,
          label: T(liveJobCount === 1 ? 'capsule.running.one' : 'capsule.running.other', {
            count: liveJobCount,
          }),
          value: null,
        };
      }

      const hasContent = Boolean(metric);
      const hasPanelContent =
        Boolean(goal) || todos.length > 0 || jobs.length > 0 || agents.length > 0;

      /** 展开策略三态：auto 用本地状态；expanded / collapsed 覆盖它。 */
      const isCollapsed = mode === 'expanded' ? false : mode === 'collapsed' ? true : collapsed;

      if (!hasContent && !hasPanelContent) return null;

      const MetricIcon = metric ? metric.icon : ListIcon;

      if (isCollapsed) {
        return h(
          'div',
          { style: ANCHOR_STYLE, 'data-zcode-status-anchor': 'true' },
          h(
            'button',
            {
              type: 'button',
              'data-zcode-status-panel': 'capsule',
              'aria-expanded': isCollapsed ? false : true,
              'aria-label': T('panel.expand'),
              title: T('panel.expand'),
              onClick: expand,
              onMouseEnter: function () {
                setCapsuleHover(true);
              },
              onMouseLeave: function () {
                setCapsuleHover(false);
              },
              onFocus: function () {
                setCapsuleHover(true);
              },
              onBlur: function () {
                setCapsuleHover(false);
              },
              style: {
                pointerEvents: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: CAPSULE_HEIGHT,
                maxWidth: 'calc(100vw - 2rem)',
                padding: '0 12px 0 8px',
                background: 'var(--dsw-specific-menu, ' + TOKEN.surface + ')',
                border: 0,
                borderRadius: 'var(--dsw-radius-lg, ' + RADIUS_SHELL + 'px)',
                color: TOKEN.text,
                cursor: 'pointer',
                font: 'inherit',
                boxShadow: 'var(--dsw-elevation-soft, 0 2px 8px rgba(0,0,0,0.10))',
                backdropFilter: 'var(--dsw-menu-backdrop-filter, none)',
              },
            },
            // ZCode：悬停/聚焦时主图标换成"展开"图标（Maximize2Icon 的等价物）。
            h(
              'span',
              { style: { display: 'flex', color: metric ? metric.color : TOKEN.muted } },
              h(capsuleHover ? MaximizeIcon : MetricIcon, { size: 15 }),
            ),
            h(
              'span',
              {
                style: {
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 300,
                },
              },
              metric ? metric.label : T('panel.title'),
            ),
            metric && metric.value
              ? h(
                  'span',
                  { style: { flex: 'none', color: TOKEN.muted, fontVariantNumeric: 'tabular-nums' } },
                  metric.value,
                )
              : null,
          ),
        );
      }

      return h(
        'div',
        { style: ANCHOR_STYLE, 'data-zcode-status-anchor': 'true' },
        h(
          'aside',
          {
            ref: function (node) {
              panelRef.current = node;
              PANEL_REF.current = node;
            },
            'data-zcode-status-panel': 'panel',
            'data-state': 'expanded',
            'aria-label': T('panel.aria'),
            style: {
              pointerEvents: 'auto',
              display: 'flex',
              flexDirection: 'column',
              width: SHELL_WIDTH,
              maxWidth: 'calc(100vw - 2rem)',
              maxHeight: 'min(64dvh, 32rem)',
              boxSizing: 'border-box',
              background: 'var(--dsw-specific-menu, ' + TOKEN.surface + ')',
              border: 0,
              borderRadius: 'var(--dsw-radius-lg, ' + RADIUS_SHELL + 'px)',
              color: TOKEN.text,
              overflow: 'hidden',
              boxShadow: 'var(--dsw-elevation-prominent, 0 6px 24px rgba(0,0,0,0.18))',
              backdropFilter: 'var(--dsw-menu-backdrop-filter, none)',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 32,
                padding: '0 8px',
                flex: 'none',
              },
            },
            h('span', { style: { display: 'flex', color: TOKEN.muted } }, h(ListIcon, { size: 14 })),
            h('span', { style: { fontWeight: 600 } }, T('panel.title')),
            h('span', { style: { flex: '1 1 auto' } }),
            h(DisplayModeMenu, { T: T, mode: mode, onChange: changeMode }),
            h(
              'button',
              {
                type: 'button',
                'data-zcode-status-panel-collapse': 'true',
                'aria-label': T('panel.collapse'),
                title: T('panel.collapse'),
                onClick: collapse,
                style: {
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: TOKEN.muted,
                  cursor: 'pointer',
                },
              },
              h(MinimizeIcon, { size: 14 }),
            ),
          ),
          h(
            'div',
            {
              style: {
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                // 滚动条占位固定（宿主滚动条宽 5px），右侧留出 12px，
                // 保证分区标题栏的尾随计数永远不被滚动条压住。
                scrollbarGutter: 'stable',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '6px 12px 6px 6px',
              },
            },
            // 分区顺序：目标 → 进程 → 后台(终端) → 工作流 → 智能体。
            // separated 逐个累加：只有"前一个分区真的渲染了"才画那条分隔线。
            goal
              ? h(
                  PanelErrorBoundary,
                  { label: 'goal' },
                  h(GoalSection, {
                    T: T,
                    goal: goal,
                    sessionId: props.sessionId,
                    separated: false,
                  }),
                )
              : null,
            todos.length > 0
              ? h(
                  PanelErrorBoundary,
                  { label: 'progress' },
                  h(ProgressSection, {
                    T: T,
                    todos: todos,
                    separated: Boolean(goal),
                  }),
                )
              : null,
            backgroundJobs.length > 0
              ? h(
                  PanelErrorBoundary,
                  { label: 'background' },
                  h(JobSection, {
                    T: T,
                    id: 'background',
                    titleKey: 'section.background',
                    jobs: backgroundJobs,
                    observed: jobsState.observed,
                    sessionId: props.sessionId,
                    // ZCode：终端分区默认收起。
                    defaultOpen: false,
                    separated: Boolean(goal || todos.length > 0),
                  }),
                )
              : null,
            workflowJobs.length > 0
              ? h(
                  PanelErrorBoundary,
                  { label: 'workflow' },
                  h(JobSection, {
                    T: T,
                    id: 'workflow',
                    titleKey: 'section.workflow',
                    icon: WorkflowIcon,
                    jobs: workflowJobs,
                    observed: jobsState.observed,
                    sessionId: props.sessionId,
                    // ZCode：工作流分区默认收起。
                    defaultOpen: false,
                    separated: Boolean(goal || todos.length > 0 || backgroundJobs.length > 0),
                  }),
                )
              : null,
            agents.length > 0
              ? h(
                  PanelErrorBoundary,
                  { label: 'agents' },
                  h(SubagentSection, {
                    T: T,
                    agents: agents,
                    parentSessionId: props.sessionId,
                    // ZCode：智能体分区默认收起。
                    defaultOpen: false,
                    separated: Boolean(goal || todos.length > 0 || jobs.length > 0),
                  }),
                )
              : null,
          ),
        ),
      );
    }

    // ------------------------------------------------------------ 注册入口
    return {
      name: 'dsh-session-status-panel',
      inject: ['slots'],
      apply: function apply(ctx) {
        // 字典用可选注入注册：没有 locale 服务时面板退回本包 zh 字典，而不是不激活。
        ctx.inject(['locale'], function (scope) {
          scope.effect(
            function () {
              return scope.locale.register(NS, { zh: ZH, en: EN });
            },
            'dsh-session-status-panel: dictionaries',
          );
        });
        // 目标动作（暂停/继续/清除）走客户端 remote.goals —— ui-goal 用的同一个命名空间
        // （它的 inject 是 ['remote', 'remote.goals', …]，所以这两个都要声明）。
        ctx.inject(['remote', 'remote.goals'], function (scope) {
          scope.effect(
            function () {
              goalsFace =
                (scope.remote && scope.remote.goals) ||
                (typeof scope.get === 'function' ? scope.get('remote.goals') : null) ||
                null;
              return function () {
                goalsFace = null;
              };
            },
            'dsh-session-status-panel: goals face',
          );
        });
        // 可选注入：没有 jobs 服务时只是少一个分区，不会让整块面板不激活。
        ctx.inject(['jobs'], function (scope) {
          scope.effect(
            function () {
              jobsFace = scope.jobs;
              return function () {
                jobsFace = null;
              };
            },
            'dsh-session-status-panel: jobs face',
          );
        });
        // 同理可选：没有右侧栏服务时，子代理行降级为不可点，其余照常。
        ctx.inject(['sidebarRight'], function (scope) {
          scope.effect(
            function () {
              sidebarRightFace = scope.sidebarRight;
              return function () {
                sidebarRightFace = null;
              };
            },
            'dsh-session-status-panel: sidebarRight face',
          );
        });
        ctx.slots.inject('conversation.input.dock', function () {
          return ctx.slots.register(
            /*
             * 复用宿主自带 todo dock 的 cell id（`todo`）+ 更低的 priority：
             * ui-slots 的 cell 规则是"同 id 只在完全相同的 priority 上冲突并抛错，
             * priority 更低者遮蔽渲染"（ui-slots/src/index.ts:1211 / :1341）。宿主
             * ui-conversation 的 todo dock 用默认 priority 0，所以 -1 会顶掉它，
             * 避免同屏出现两个进度显示；本插件被禁用或卸载时宿主那个自动回来。
             * `order: 0` 沿用该 cell 原本的排位。
             * `locale: NS` 让渲染器注入本命名空间的 t（缺 locale 服务时组件退回 zh 字典）。
             */
            { name: 'conversation.input.dock', id: 'todo', order: 0, priority: -1, locale: NS },
            StatusPanel,
          );
        });
      },
    };
  },
});


