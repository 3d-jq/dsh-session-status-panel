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
    const { useCallback, useEffect, useMemo, useState } = React;

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
      'todo.fold.before': '前面 {count} 项',
      'todo.fold.after': '后面 {count} 项',
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
      'todo.fold.before': '{count} earlier',
      'todo.fold.after': '{count} later',
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
    function glyph(children) {
      return function Glyph(props) {
        const size = (props && props.size) || 16;
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            style: { display: 'block', flex: 'none' },
          },
          children,
        );
      };
    }
    const GoalIcon = glyph([
      h('circle', { key: 'o', cx: 12, cy: 12, r: 9 }),
      h('circle', { key: 'm', cx: 12, cy: 12, r: 4 }),
    ]);
    const ListIcon = glyph([
      h('path', { key: 'l1', d: 'M4 6h10' }),
      h('path', { key: 'l2', d: 'M4 12h10' }),
      h('path', { key: 'l3', d: 'M4 18h10' }),
      h('path', { key: 'c', d: 'M18 17l2 2 3-3' }),
    ]);
    const ArrowRightIcon = glyph([
      h('path', { key: 'a', d: 'M5 12h13' }),
      h('path', { key: 'b', d: 'M13 7l5 5-5 5' }),
    ]);
    const CheckIcon = glyph([h('path', { key: 'c', d: 'M20 6L9 17l-5-5' })]);
    const CircleIcon = glyph([h('circle', { key: 'c', cx: 12, cy: 12, r: 8 })]);
    const MaximizeIcon = glyph([
      h('path', { key: '1', d: 'M9 4H5a1 1 0 0 0-1 1v4' }),
      h('path', { key: '2', d: 'M15 4h4a1 1 0 0 1 1 1v4' }),
      h('path', { key: '3', d: 'M15 20h4a1 1 0 0 0 1-1v-4' }),
      h('path', { key: '4', d: 'M9 20H5a1 1 0 0 1-1-1v-4' }),
    ]);
    const MinimizeIcon = glyph([
      h('path', { key: '1', d: 'M9 4v4a1 1 0 0 1-1 1H4' }),
      h('path', { key: '2', d: 'M15 4v4a1 1 0 0 0 1 1h4' }),
      h('path', { key: '3', d: 'M15 20v-4a1 1 0 0 1 1-1h4' }),
      h('path', { key: '4', d: 'M9 20v-4a1 1 0 0 0-1-1H4' }),
    ]);
    const ChevronDownIcon = glyph([h('path', { key: 'c', d: 'M6 9l6 6 6-6' })]);
    const ChevronLeftIcon = glyph([h('path', { key: 'c', d: 'M15 6l-6 6 6 6' })]);
    const ChevronRightIcon = glyph([h('path', { key: 'c', d: 'M9 6l6 6-6 6' })]);
    const TerminalIcon = glyph([
      h('rect', { key: 'r', x: 3, y: 4, width: 18, height: 16, rx: 2 }),
      h('path', { key: 'p', d: 'M7 9l3 3-3 3' }),
      h('path', { key: 'l', d: 'M13 15h4' }),
    ]);
    const BotIcon = glyph([
      h('rect', { key: 'r', x: 4, y: 8, width: 16, height: 11, rx: 3 }),
      h('path', { key: 'a', d: 'M12 4v4' }),
      h('circle', { key: 'c', cx: 12, cy: 3, r: 1 }),
      h('circle', { key: 'e1', cx: 9.5, cy: 13.5, r: 1 }),
      h('circle', { key: 'e2', cx: 14.5, cy: 13.5, r: 1 }),
    ]);

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

    function FoldRow(props) {
      const [hover, setHover] = useState(false);
      return h(
        'li',
        { style: { listStyle: 'none' } },
        h(
          'button',
          {
            type: 'button',
            'data-todo-fold': props.group,
            'aria-expanded': false,
            'aria-label': props.ariaLabel,
            onClick: props.onClick,
            onMouseEnter: function () {
              setHover(true);
            },
            onMouseLeave: function () {
              setHover(false);
            },
            style: Object.assign({}, sectionHeaderStyle, {
              height: 30,
              borderRadius: 8,
              color: TOKEN.muted,
              background: hover ? TOKEN.hover : 'transparent',
            }),
          },
          h(ChevronLeftIcon, { size: 14 }),
          h('span', null, props.label),
        ),
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
      );
    }

    function ProgressSection(props) {
      const T = props.T;
      const todos = props.todos;
      const counts = todoCounts(todos);
      const [showBefore, setShowBefore] = useState(false);
      const [showAfter, setShowAfter] = useState(false);
      const window = todoFocusWindow(todos);

      let rows = [];
      if (!window) {
        rows = todos.map(function (item, index) {
          return h(TodoRow, { key: item.content + '#' + index, item: item });
        });
      } else {
        const before = todos.slice(0, window.start);
        const focus = todos.slice(window.start, window.end);
        const after = todos.slice(window.end);
        rows = [];
        if (before.length > 0) {
          if (showBefore) {
            before.forEach(function (item, index) {
              rows.push(h(TodoRow, { key: 'b' + index, item: item }));
            });
          } else {
            rows.push(
              h(FoldRow, {
                key: 'fold-before',
                group: 'before',
                label: T('todo.fold.before', { count: before.length }),
                ariaLabel: T('todo.fold.aria', { count: before.length }),
                onClick: function () {
                  setShowBefore(true);
                },
              }),
            );
          }
        }
        focus.forEach(function (item, index) {
          rows.push(h(TodoRow, { key: 'f' + index, item: item }));
        });
        if (after.length > 0) {
          if (showAfter) {
            after.forEach(function (item, index) {
              rows.push(h(TodoRow, { key: 'a' + index, item: item }));
            });
          } else {
            rows.push(
              h(FoldRow, {
                key: 'fold-after',
                group: 'after',
                label: T('todo.fold.after', { count: after.length }),
                ariaLabel: T('todo.fold.aria', { count: after.length }),
                onClick: function () {
                  setShowAfter(true);
                },
              }),
            );
          }
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
        output,
      );
    }

    function JobSection(props) {
      const T = props.T;
      const jobs = props.jobs;
      const liveCount = jobs.filter(function (job) {
        return jobIsLive(job.status);
      }).length;
      return h(
        Section,
        {
          id: 'background',
          title: T('section.background'),
          icon: TerminalIcon,
          defaultOpen: true,
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
          defaultOpen: true,
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
      const [collapsed, setCollapsed] = useState(true);

      const collapse = useCallback(function () {
        setCollapsed(true);
      }, []);
      const expand = useCallback(function () {
        setCollapsed(false);
      }, []);

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
      const hasPanelContent = Boolean(goal) || todos.length > 0 || jobs.length > 0 || agents.length > 0;

      if (!hasContent && !hasPanelContent) return null;

      const MetricIcon = metric ? metric.icon : ListIcon;

      if (collapsed) {
        return h(
          'div',
          { style: ANCHOR_STYLE, 'data-zcode-status-anchor': 'true' },
          h(
            'button',
            {
              type: 'button',
              'data-zcode-status-panel': 'capsule',
              'aria-expanded': false,
              'aria-label': T('panel.expand'),
              title: T('panel.expand'),
              onClick: expand,
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
            h('span', { style: { display: 'flex', color: metric ? metric.color : TOKEN.muted } }, h(MetricIcon, { size: 15 })),
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
            h(
              'button',
              {
                type: 'button',
                'data-zcode-status-panel-collapse': 'true',
                'aria-label': T('panel.collapse'),
                title: T('panel.collapse'),
                onClick: collapse,
                style: {
                  marginLeft: 'auto',
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
            goal
              ? h(
                  PanelErrorBoundary,
                  { label: 'goal' },
                  h(GoalSection, { T: T, goal: goal, separated: false }),
                )
              : null,
            todos.length > 0
              ? h(
                  PanelErrorBoundary,
                  { label: 'progress' },
                  h(ProgressSection, { T: T, todos: todos, separated: Boolean(goal) }),
                )
              : null,
            jobs.length > 0
              ? h(
                  PanelErrorBoundary,
                  { label: 'background' },
                  h(JobSection, {
                    T: T,
                    jobs: jobs,
                    observed: jobsState.observed,
                    sessionId: props.sessionId,
                    separated: Boolean(goal) || todos.length > 0,
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
                    separated: Boolean(goal) || todos.length > 0 || jobs.length > 0,
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
