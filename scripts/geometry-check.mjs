/**
 * 浮层坐标换算的单元测试。
 *
 * 为什么要有：上一版把"距视口右缘的距离"和"面板矩形的绝对 x"混在一起相减，
 * 菜单被推到视口外（看起来就是"点了没反应"）。这类 bug 渲染探针抓不到
 * （它不接真实 DOM / 视口），所以把三个几何函数写成纯函数后直接测。
 *
 * 用法：node scripts/geometry-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../client.js'), 'utf8');

/** 从 client.js 里抽出这三个纯函数（它们不依赖闭包里的任何东西）。 */
function extract(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('client.js 里找不到 ' + name);
  const end = source.indexOf('\n    }', start);
  if (end < 0) throw new Error(name + ' 的函数体没有正常结束');
  // eslint-disable-next-line no-new-func
  return new Function(source.slice(start, end + 6) + ' return ' + name + ';')();
}

const clampTop = extract('clampTop');
const clampRightEdge = extract('clampRightEdge');
const panelOffset = extract('panelOffset');

// 典型场景：视口 1600×900，面板宽 384、右侧留 16px → 面板矩形 x=[1200,1584] y=[60,820]
const VIEWPORT_W = 1600;
const VIEWPORT_H = 900;
const PANEL = { top: 60, right: 1584 };
const MENU_WIDTH = 208;
const MENU_HEIGHT = 160;

const cases = [
  // [描述, 实际, 期望]
  [
    'clampTop: 按钮下方不越界（视口顶部 100px）',
    clampTop(104, MENU_HEIGHT, VIEWPORT_H),
    104,
  ],
  [
    'clampTop: 靠近视口底部时压回上界',
    clampTop(880, MENU_HEIGHT, VIEWPORT_H),
    VIEWPORT_H - MENU_HEIGHT - 8,
  ],
  [
    'clampRightEdge: 按钮右缘就是视口右缘时，右缘压到 1592（= 视口 - 8，卡片不溢出）',
    clampRightEdge(1600, MENU_WIDTH, VIEWPORT_W),
    VIEWPORT_W - 8,
  ],
  [
    'clampRightEdge: 按钮在视口内则原样保留',
    clampRightEdge(1576, MENU_WIDTH, VIEWPORT_W),
    1576,
  ],
  [
    'panelOffset: 菜单右缘对齐按钮右缘（面板空间 right = 8）',
    panelOffset(PANEL, { top: 104, rightEdge: 1576 }).right,
    8,
  ],
  [
    'panelOffset: 菜单 top = 按钮下沿相对面板顶（104-60 = 44）',
    panelOffset(PANEL, { top: 104, rightEdge: 1576 }).top,
    44,
  ],
  [
    'panelOffset: 面板矩形缺失时安全回退到原点',
    panelOffset(null, { top: 104, rightEdge: 1576 }).right,
    0,
  ],
  [
    'panelOffset: 预览卡右缘在折叠行左侧 10px（面板空间 right = 1584-1190）',
    panelOffset(PANEL, { top: 300, rightEdge: 1200 - 10 }).right,
    394,
  ],
  [
    'clampRightEdge: 右缘离视口右缘太近时压回上界（卡片不会溢出屏幕）',
    clampRightEdge(1600, 264, VIEWPORT_W),
    VIEWPORT_W - 8,
  ],
];

let failed = 0;
console.log('[geometry-check] 浮层坐标换算');
for (const [label, actual, expected] of cases) {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + '  →  ' + actual + (ok ? '' : '（期望 ' + expected + '）'));
}
console.log(failed === 0 ? '  ✅ 全部通过' : '  ❌ ' + failed + ' 项失败');
process.exitCode = failed === 0 ? 0 : 1;