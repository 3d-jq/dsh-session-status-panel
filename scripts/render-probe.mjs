/**
 * 发布前检查 2/2：渲染探针。
 *
 * 用最小 React 桩求值 client.js，拿到注册的组件，再逐个调用函数组件跑状态矩阵
 * （收起/展开 × 目标三态 × 待办 0/3/7 × 有无 jobs × 有无 agents × 有无 t = 144 组），
 * 报告第一个抛出点、无效元素类型，以及组件覆盖面。
 *
 * 它能抓的是「渲染期抛出的 JS 错误 / 无效元素类型」；React 自身的规则错误
 * （hook 顺序、uSES 无限循环）与提交期 effect 错误它抓不到——发布前仍应在真实页面点一遍。
 *
 * 用法：node scripts/render-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(here, '../client.js'), 'utf8');

let forcedStates = [];
/**
 * 展开态那轮把「布尔初值」一律当作 true：这样默认收起的分区（后台/工作流/智能体，
 * ZCode 行为）也会渲染出它们的行。否则探针不点击就永远走不到 JobRow/SubagentRow，
 * 而停止按钮正好在那两行里。
 */
let forceBooleanTrue = false;
const resolveInitial = (init) => (typeof init === 'function' ? init() : init);
const React = {
  createElement(type, props, ...children) {
    const flat = [];
    const push = (child) => {
      if (Array.isArray(child)) child.forEach(push);
      else if (child !== null && child !== undefined && child !== false) flat.push(child);
    };
    children.forEach(push);
    // React 把子元素放进 props.children；只放 element.children 会让读 props.children
    // 的组件（错误边界的 passthrough）截断子树，探针就会假通过。
    const withChildren = Object.assign({}, props || {});
    if (flat.length === 1) withChildren.children = flat[0];
    else if (flat.length > 1) withChildren.children = flat;
    return { type, props: withChildren, children: flat };
  },
  useState(init) {
    const forced = forcedStates.shift();
    if (forced !== undefined) return [forced, () => {}];
    const resolved = resolveInitial(init);
    if (forceBooleanTrue && typeof resolved === 'boolean') return [true, () => {}];
    return [resolved, () => {}];
  },
  useEffect() {},
  useMemo(fn) {
    return fn();
  },
  useCallback(fn) {
    return fn;
  },
  useRef(initial) {
    return { current: initial };
  },
};

const NOW = Date.now();
const makeJobsFace = () => ({
  state: {
    getSnapshot: () => ({
      rows: {
        'session-probe': [
          { id: 'bash-1', kind: 'bash', label: 'demo', status: 'running', progress: '1/2', startedAt: NOW - 5000, output: { total: 10, earliest: 0 } },
          { id: 'bash-2', kind: 'bash', label: 'failed one', status: 'failed', startedAt: NOW - 9000, finishedAt: NOW - 1000, output: { total: 0, earliest: 0 } },
          { id: 'bash-3', kind: 'bash', label: 'stopped one', status: 'killed', startedAt: NOW - 9000, finishedAt: NOW - 2000, output: { total: 0, earliest: 0 } },
          { id: 'wf-1', kind: 'workflow', label: 'wf', status: 'completed', startedAt: NOW - 9000, finishedAt: NOW - 2000, output: { total: 3, earliest: 0 } },
        ],
      },
      observed: { 'bash-1': { jobId: 'bash-1', text: 'line1\nline2', gapBefore: true, streaming: true } },
    }),
    subscribe: () => () => {},
  },
  watchRows: () => () => {},
  observe: () => () => {},
  kill: async () => true,
});

const captured = {};
new Function('window', SOURCE)({ __ModuleLoader__: { load: (reg) => (captured.reg = reg) } });
if (!captured.reg) throw new Error('client.js 没有调用 __ModuleLoader__.load');
const plugin = captured.reg.factory((id) => {
  if (id === 'react') return React;
  throw new Error('未预期的 require: ' + id);
});

let registered = null;
function applyWith(withJobs) {
  registered = null;
  const ctx = {
    inject(deps, cb) {
      if (deps.includes('jobs') && !withJobs) return; // 模拟缺服务：回调不触发
      cb({
        jobs: makeJobsFace(),
        sidebarRight: { openResource: () => {} },
        locale: { register: () => () => {} },
        // 目标动作面（ui-goal 用的同一个 remote.goals）；缺它时目标分区只剩只读展示。
        remote: {
          goals: {
            get: async () => undefined,
            pause: async () => undefined,
            resume: async () => undefined,
            clear: async () => undefined,
          },
        },
        get: () => undefined,
        effect: (fn) => {
          fn();
          return () => {};
        },
      });
    },
    effect: (fn) => {
      fn();
      return () => {};
    },
    slots: {
      inject: (key, cb) => {
        cb();
        return () => {};
      },
      register: (spec, component) => {
        registered = { spec, component };
        return () => {};
      },
    },
  };
  plugin.apply(ctx);
  if (!registered) throw new Error('插件没有注册 slot 条目');
}

const matrix = [];
for (const collapsed of [false, true])
  for (const goal of ['active', 'paused', 'blocked', 'complete', 'none'])
    for (const todoCount of [0, 3, 7])
      for (const withJobs of [true, false])
        for (const withAgents of [true, false])
          for (const withT of [true, false])
            matrix.push({ collapsed, goal, todoCount, withJobs, withAgents, withT });

function makeFixture(state) {
  const todos = [];
  if (state.todoCount === 3) {
    todos.push(
      { content: 'done', status: 'completed' },
      { content: 'active', status: 'in_progress' },
      { content: 'pending', status: 'pending' },
    );
  } else if (state.todoCount === 7) {
    for (let i = 1; i <= 7; i += 1) {
      todos.push({ content: 'todo ' + i, status: i <= 4 ? 'completed' : i === 5 ? 'in_progress' : 'pending' });
    }
  }
  const goal =
    state.goal === 'none'
      ? undefined
      : {
          goal: {
            id: 'goal-probe',
            revision: 1,
            objective: 'probe objective',
            phase: state.goal,
            maxGoalRounds: 3,
            ...(state.goal === 'blocked' ? { blockedReason: { code: 'x', message: 'blocked' } } : {}),
          },
          roundsStarted: 1,
          createdAt: NOW - 60000,
          updatedAt: NOW - 1000,
        };
  return {
    useProjection: (key) => {
      if (key === 'todos') return todos;
      if (key === 'goal') return goal;
      if (key === 'plan') return { active: true, pending: false };
      if (key === 'subagentCatalog') {
        return state.withAgents
          ? [
              { id: 'child-1', createdAt: NOW - 3000, mode: 'continuable', label: 'continuable child' },
              { id: 'child-2', createdAt: NOW - 2000, mode: 'one-shot' },
            ]
          : [];
      }
      return undefined;
    },
    sessionId: 'session-probe',
    ...(state.withT
      ? {
          t: (key, params) => {
            let text = String(key);
            if (params) {
              for (const name of Object.keys(params)) text = text.split('{' + name + '}').join(String(params[name]));
            }
            return text;
          },
        }
      : {}),
  };
}

const problems = [];
const covered = new Set();
function render(element, path, fixture) {
  if (element === null || element === undefined || typeof element === 'boolean') return;
  if (Array.isArray(element)) {
    element.forEach((child, i) => render(child, path + '[' + i + ']', fixture));
    return;
  }
  if (typeof element !== 'object') return;
  const type = element.type;
  if (type === undefined || type === null) {
    problems.push(path + ' → 元素类型为 ' + String(type) + '（React 会抛 Element type is invalid）');
    return;
  }
  if (typeof type !== 'string' && typeof type !== 'function') {
    problems.push(path + ' → 无效元素类型: ' + typeof type);
    return;
  }
  if (typeof type === 'function') {
    const name = type.name || 'Anonymous';
    covered.add(name);
    try {
      render(type(Object.assign({}, fixture, element.props)), path + '/' + name, fixture);
    } catch (error) {
      problems.push(path + '/' + name + ' → 抛出: ' + (error && error.message));
    }
    return;
  }
  element.children.forEach((child, i) => render(child, path + '[' + i + ']', fixture));
}

for (const state of matrix) {
  applyWith(state.withJobs);
  // StatusPanelBody 的 useState 顺序：useJobsState 的 snapshot → mode → collapsed。
  // 要展开态就得给第 3 个塞 false。**这个位置会随实现漂移**，所以下面还有一道
  // 覆盖面断言：夹具一旦失效，探针直接失败，不再"覆盖面=3 且全部通过"。
  forcedStates = state.collapsed ? [] : [undefined, undefined, false];
  forceBooleanTrue = !state.collapsed;
  const fixture = makeFixture(state);
  try {
    render(registered.component(fixture), 'StatusPanel', fixture);
  } catch (error) {
    problems.push('矩阵 ' + JSON.stringify(state) + ' → ' + (error && error.message));
  }
}

console.log('[render-probe] ' + matrix.length + ' 个状态组合');
console.log('  组件覆盖面（' + covered.size + '）：' + [...covered].sort().join(', '));

// 覆盖面断言：矩阵覆盖了 收起/展开 × 目标 × 待办 0/3/7 × jobs × agents，
// 所以这些组件**必须**都被走到。缺任何一个都说明夹具失效（例如 useState 顺序变了），
// 那种"全绿但只覆盖 3 个组件"的假通过正是它要防的。
const EXPECTED_COVERAGE = ['StatusPanelBody', 'Section', 'TodoRow', 'FoldRow', 'JobRow', 'SubagentRow', 'GoalSection', 'ProgressSection', 'JobSection', 'SubagentSection'];
const missingCoverage = EXPECTED_COVERAGE.filter((name) => !covered.has(name));
if (missingCoverage.length > 0) {
  problems.push('夹具失效：这些组件没被走到 → ' + missingCoverage.join(', '));
}

if (problems.length === 0) {
  console.log('  ✅ 无抛出、无无效元素类型');
} else {
  const unique = [...new Set(problems)];
  console.log('  ❌ ' + problems.length + ' 处问题（去重 ' + unique.length + '）：');
  for (const line of unique.slice(0, 25)) console.log('     ' + line);
  process.exitCode = 1;
}
