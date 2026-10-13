/**
 * ZCode 模型层移植的单元测试。
 *
 * 被测对象：client.js 里内联的 ZCode 原版实现（源文件 zcode-model.js）。
 * 这些函数决定面板的**全部显示规则**：计数、优先级链、降级行、Stop 判据、空态判定。
 * 它们是纯函数，所以能在 Node 里直接跑——这正是它们必须被搬过来而不是重写的原因。
 *
 * 用法：node scripts/zcode-model-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(resolve(here, '../client.js'), 'utf8');

/**
 * 从 client.js 的注入块里取出被测函数。
 *
 * 整块求值而不是逐个抽：这些函数互相调用（buildConversationStatusPanelModel 调
 * buildGitModel / buildPlanModel / buildRunningWorkflowRuns…），单独抽一个必然缺引用。
 * 注入块是纯函数、不碰 React，直接 `new Function` 求值即可拿到全部导出。
 */
function loadModelExports() {
  const begin = client.indexOf('// __ZCODE_MODEL_BEGIN__');
  const end = client.indexOf('// __ZCODE_MODEL_END__');
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error('client.js 里找不到 __ZCODE_MODEL_BEGIN__ / __ZCODE_MODEL_END__');
  }
  const block = client.slice(begin, end);
  const names = [
    'buildConversationStatusPanelModel',
    'buildPlanModel',
    'buildGitModel',
    'buildRunningWorkflowRuns',
    'workflowRunStepCounts',
    'workflowRunOpenTarget',
    'resolveSoleRunningWorkflowRunTarget',
    'buildSessionPlansModel',
  ];
  // eslint-disable-next-line no-new-func
  return new Function(block + '\nreturn { ' + names.join(', ') + ' };')();
}

const {
  buildConversationStatusPanelModel: buildModel,
  buildPlanModel,
  buildGitModel,
  buildRunningWorkflowRuns,
  workflowRunStepCounts,
  workflowRunOpenTarget,
  resolveSoleRunningWorkflowRunTarget: resolveSole,
} = loadModelExports();

const cases = [];
const check = (label, actual, expected) =>
  cases.push([label, JSON.stringify(actual) === JSON.stringify(expected), actual, expected]);

// ── buildPlanModel：ZCode 明确要求保留 snapshot 原序（按状态重排会破坏 TodoWrite 权威顺序）
check(
  'buildPlanModel: 保留原序 + 计数',
  buildPlanModel({
    items: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
      { content: 'd', status: 'completed' },
    ],
  }),
  {
    items: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
      { content: 'd', status: 'completed' },
    ],
    displayItems: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
      { content: 'd', status: 'completed' },
    ],
    completedCount: 2,
    waitingCount: 2,
    totalCount: 4,
  },
);
check('buildPlanModel: 空列表 → null', buildPlanModel({ items: [] }), null);
check('buildPlanModel: null → null', buildPlanModel(null), null);

// ── buildGitModel：ZCode 的关键规则「added + removed <= 0 就不挂 Git 分区」
check(
  'buildGitModel: clean repo（有 gitSummary 但无行级改动）→ null',
  buildGitModel({
    gitSummary: { isGitAvailable: true, isRepository: true, isDirty: false, branchName: 'main', ahead: 0 },
    gitDirtyFileCount: 0,
    gitWorktreeChangeSummary: { added: 0, removed: 0 },
  }),
  null,
);
check(
  'buildGitModel: 非仓库 → null',
  buildGitModel({ gitSummary: { isGitAvailable: true, isRepository: false } }),
  null,
);
check(
  'buildGitModel: git 不可用 → null',
  buildGitModel({ gitSummary: { isGitAvailable: false, isRepository: true } }),
  null,
);
check(
  'buildGitModel: 有行级改动 → 出模型并带上分支/增删',
  buildGitModel({
    gitSummary: {
      isGitAvailable: true,
      isRepository: true,
      isDirty: true,
      branchName: 'feat/x',
      headRefType: 'branch',
      ahead: 2,
      behind: 1,
    },
    gitDirtyFileCount: 3,
    gitWorktreeChangeSummary: { added: 10, removed: 4 },
  }),
  {
    branchName: 'feat/x',
    headRefType: 'branch',
    dirtyFileCount: 3,
    added: 10,
    removed: 4,
    ahead: 2,
    behind: 1,
    isClean: false,
  },
);

// ── buildRunningWorkflowRuns：ZCode 的降级行规则
check(
  'buildRunningWorkflowRuns: run 有 work 无 → 只有状态词与步数，没有 workId',
  buildRunningWorkflowRuns(
    [
      {
        runId: 'run-1',
        status: 'running',
        toolCallId: 'tc-1',
        nodes: [
          { phase: 'settled', status: 'done' },
          { phase: 'running', status: 'running' },
        ],
        usage: {},
      },
    ],
    new Map(),
  ),
  [
    {
      runId: 'run-1',
      toolCallId: 'tc-1',
      status: 'running',
      nodesSettled: 1,
      nodesTotal: 2,
    },
  ],
);
check(
  'buildRunningWorkflowRuns: work 有 run 无（running）→ 降级行追加在末尾，带 Stop',
  buildRunningWorkflowRuns(
    [],
    new Map([
      ['wf-9', { workId: 'wf-9', kind: 'workflow', title: 'audit', status: 'running', startedAt: 7 }],
    ]),
  ),
  [{ runId: 'wf-9', workId: 'wf-9', title: 'audit', startedAt: 7, cancellable: true }],
);
check(
  'buildRunningWorkflowRuns: work 有但已结束 → 不产出降级行（点了没反应的 Stop 不该出现）',
  buildRunningWorkflowRuns(
    [],
    new Map([['wf-8', { workId: 'wf-8', kind: 'workflow', title: 'done', status: 'completed', startedAt: 5 }]]),
  ),
  [],
);
check(
  'buildRunningWorkflowRuns: 已 join 的 work 不再重复出降级行',
  buildRunningWorkflowRuns(
    [{ runId: 'wf-1', status: 'pending', nodes: [], usage: {} }],
    new Map([['wf-1', { workId: 'wf-1', kind: 'workflow', title: 't', status: 'running', startedAt: 1 }]]),
  ).length,
  1,
);
check(
  'buildRunningWorkflowRuns: pending 也是活动态（不能藏起来造成空窗）',
  buildRunningWorkflowRuns(
    [{ runId: 'run-p', status: 'pending', nodes: [], usage: {} }],
    new Map(),
  ).length,
  1,
);

// ── workflowRunStepCounts：表内 + 表外（usage.nodesUnlisted）
// 上游判据是 node.phase === 'settled'（workflow-runs-caps.ts:120），不是 status。
check(
  'workflowRunStepCounts: 按 phase=settled 计数，不是按 status',
  workflowRunStepCounts({
    nodes: [
      { phase: 'settled', status: 'done' },
      { phase: 'running', status: 'done' }, // status 已 done 但相位未结算 → 不计
      { phase: 'pending', status: 'running' },
    ],
    usage: { nodesUnlisted: 3, nodesUnlistedSettled: 1 },
  }),
  { total: 6, settled: 2 },
);

// ── workflowRunOpenTarget：title ≡ runId 即未命名，不带 workflowName
check(
  'workflowRunOpenTarget: title ≡ runId 时不带 workflowName',
  workflowRunOpenTarget({ runId: 'r1', toolCallId: 't1', title: 'r1' }),
  { runId: 'r1', toolCallId: 't1' },
);
check(
  'workflowRunOpenTarget: 无 toolCallId → null（降级行不可点）',
  workflowRunOpenTarget({ runId: 'r1' }),
  null,
);

// ── resolveSoleRunningWorkflowRunTarget：徽标直达的排除条件
check(
  'resolveSole: 有 bash 在跑 → null',
  resolveSole({
    runningBashWorks: [{ workId: 'b1' }],
    runningSubagentWorks: [],
    runningWorkflowRuns: [{ runId: 'r1', toolCallId: 't1' }],
  }),
  null,
);
check(
  'resolveSole: 两条 workflow → null（选哪条是用户的事）',
  resolveSole({
    runningBashWorks: [],
    runningSubagentWorks: [],
    runningWorkflowRuns: [
      { runId: 'r1', toolCallId: 't1' },
      { runId: 'r2', toolCallId: 't2' },
    ],
  }),
  null,
);
check(
  'resolveSole: 恰好一条可开 → 给出打开意图',
  resolveSole({
    runningBashWorks: [],
    runningSubagentWorks: [],
    runningWorkflowRuns: [{ runId: 'r1', toolCallId: 't1' }],
  }),
  { runId: 'r1', toolCallId: 't1' },
);

// ── buildConversationStatusPanelModel：分区归位 + hasContent
const modelWithWork = buildModel({
  backgroundWorks: [
    { workId: 'bash-1', kind: 'bash', title: 'b', status: 'running', startedAt: 1 },
    { workId: 'sub-1', kind: 'subagent', title: 's', status: 'running', startedAt: 2, childSessionId: 'child-1' },
    { workId: 'wf-1', kind: 'workflow', title: 'w', status: 'running', startedAt: 3 },
    { workId: 'bash-end', kind: 'bash', title: 'done', status: 'resultPending', startedAt: 4 },
  ],
  runningSubagents: [{ childSessionId: 'child-1', subagentType: 'subagent', title: 's', status: 'running' }],
  plan: { items: [{ id: '1', content: 't', status: 'pending' }] },
});
check('buildModel: bash 分区只收 running 的', modelWithWork.runningBashWorks.map((w) => w.workId), ['bash-1']);
check(
  'buildModel: subagent 行关联到 Stop 控制（精确 childSessionId 匹配）',
  modelWithWork.runningSubagentWorks.map((a) => [a.childSessionId, a.controlWorkId, a.cancellable]),
  [['child-1', 'sub-1', true]],
);
check(
  'buildModel: workflow work 进 workflow 联接表并出降级行',
  modelWithWork.runningWorkflowRuns.map((r) => [r.runId, r.workId, r.cancellable]),
  [['wf-1', 'wf-1', true]],
);
check('buildModel: hasContent 由任一分支为真', modelWithWork.hasContent, true);
check(
  'buildModel: 什么都没有 → hasContent false',
  buildModel({}).hasContent,
  false,
);
check(
  'buildModel: 重复 childSessionId 身份 → 宁可不显示控制（不猜）',
  buildModel({
    backgroundWorks: [
      { workId: 'sub-a', kind: 'subagent', title: 'a', status: 'running', startedAt: 1, childSessionId: 'c1' },
      { workId: 'sub-b', kind: 'subagent', title: 'b', status: 'running', startedAt: 2, childSessionId: 'c1' },
    ],
    runningSubagents: [{ childSessionId: 'c1', subagentType: 'subagent', title: 'x', status: 'running' }],
  }).runningSubagentWorks.map((a) => [a.childSessionId, a.controlWorkId ?? null]),
  [['c1', null]],
);
check(
  'buildModel: work 有事实但 subagents 投影缺行 → 用权威 work 补齐控制',
  buildModel({
    backgroundWorks: [
      { workId: 'sub-z', kind: 'subagent', title: 'z', status: 'running', startedAt: 1, childSessionId: 'c2' },
    ],
    runningSubagents: [],
  }).runningSubagentWorks.map((a) => [a.childSessionId, a.controlWorkId, a.status]),
  [['c2', 'sub-z', 'running']],
);

let failed = 0;
console.log('[zcode-model-check] ZCode 模型层移植（' + cases.length + ' 条）');
for (const [label, ok, actual, expected] of cases) {
  if (!ok) failed += 1;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label);
  if (!ok) {
    console.log('        实际: ' + JSON.stringify(actual));
    console.log('        期望: ' + JSON.stringify(expected));
  }
}
console.log(failed === 0 ? '  ✅ 全部通过' : '  ❌ ' + failed + ' 条失败');
process.exitCode = failed === 0 ? 0 : 1;