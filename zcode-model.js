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