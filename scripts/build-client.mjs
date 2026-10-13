/**
 * 构建脚本：把 zcode-model.js 的内容内联进 client.js 的注入标记之间。
 *
 * 为什么要有这个脚本：插件浏览器半区跑在沙箱里，只有 `require('react')`，**不能 import**，
 * 所以移植进来的 ZCode 模型层必须内联。同时把「源文件」单独留出来，好让移植内容
 * 可被 diff、可被评审——这正是 docs/practices.md 要求的「改名加前缀 + 可追溯」的落地方式。
 *
 * 实现要点（按行处理，不做字符级偏移拼接）：
 *   - 定位：整行匹配标记（行首空白 + 标记 + 行尾空白），裸 indexOf 会被注释里的同名文字误匹配；
 *   - 比较：把「标记行之间的内容」规范化（统一换行、去尾随空行）后再比，避免非幂等；
 *   - 写回：整段替换，标记行本身保留原缩进。
 *
 * 用法：node scripts/build-client.mjs [--check]
 *   --check 只校验内联内容与 zcode-model.js 是否一致（门禁用，不写文件）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const MODEL_FILE = resolve(root, 'zcode-model.js');
const ICONS_FILE = resolve(root, 'dsh-icons.js');
const STYLES_FILE = resolve(root, 'panel-styles.js');
const CLIENT_FILE = resolve(root, 'client.js');

const BEGIN_TEXT = '// __ZCODE_MODEL_BEGIN__';
const END_TEXT = '// __ZCODE_MODEL_END__';
const ICONS_BEGIN = '// __DSH_ICONS_BEGIN__';
const ICONS_END = '// __DSH_ICONS_END__';
const STYLES_BEGIN = '// __DSH_STYLES_BEGIN__';
const STYLES_END = '// __DSH_STYLES_END__';

const isMarker = (line, text) => line.trim() === text;

const normalizeNewlines = (text) => text.replace(/\r\n?/g, '\n');

const modelLines = normalizeNewlines(readFileSync(MODEL_FILE, 'utf8'))
  .replace(/\s+$/, '')
  .split('\n');
// 图标表源码是 ESM（export const …），内联时要去掉 export 并把顶层 const 收进闭包。
const iconLines = normalizeNewlines(readFileSync(ICONS_FILE, 'utf8'))
  .replace(/^export /gm, '')
  .replace(/\s+$/, '')
  .split('\n');
// 样式表同理；模板字符串里的 CSS 保持原样。
const styleLines = normalizeNewlines(readFileSync(STYLES_FILE, 'utf8'))
  .replace(/^export /gm, '')
  .replace(/\s+$/, '')
  .split('\n');

const clientText = normalizeNewlines(readFileSync(CLIENT_FILE, 'utf8'));
const clientLines = clientText.split('\n');

const find = (text) => clientLines.findIndex((line) => isMarker(line, text));
const beginIndex = find(BEGIN_TEXT);
const endIndex = find(END_TEXT);
const iconsBeginIndex = find(ICONS_BEGIN);
const iconsEndIndex = find(ICONS_END);
const stylesBeginIndex = find(STYLES_BEGIN);
const stylesEndIndex = find(STYLES_END);
if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
  throw new Error('client.js 里找不到成对的 ' + BEGIN_TEXT + ' / ' + END_TEXT + ' 标记行');
}
if (iconsBeginIndex < 0 || iconsEndIndex < 0 || iconsEndIndex < iconsBeginIndex) {
  throw new Error('client.js 里找不到成对的 ' + ICONS_BEGIN + ' / ' + ICONS_END + ' 标记行');
}
if (stylesBeginIndex < 0 || stylesEndIndex < 0 || stylesEndIndex < stylesBeginIndex) {
  throw new Error('client.js 里找不到成对的 ' + STYLES_BEGIN + ' / ' + STYLES_END + ' 标记行');
}

const indentOf = (line) => (line.match(/^[ \t]*/) || [''])[0];
const indentLines = (lines, indent) => lines.map((line) => (line.length > 0 ? indent + line : line));

const modelIndent = indentOf(clientLines[beginIndex]);
const iconsIndent = indentOf(clientLines[iconsBeginIndex]);
const stylesIndent = indentOf(clientLines[stylesBeginIndex]);
const wantModel = indentLines(modelLines, modelIndent);
const wantIcons = indentLines(iconLines, iconsIndent);
const wantStyles = indentLines(styleLines, stylesIndent);

const haveModel = clientLines.slice(beginIndex + 1, endIndex);
const haveIcons = clientLines.slice(iconsBeginIndex + 1, iconsEndIndex);
const haveStyles = clientLines.slice(stylesBeginIndex + 1, stylesEndIndex);

const same = (a, b) => a.length === b.length && a.every((line, i) => line === b[i]);
const modelInSync = same(haveModel, wantModel);
const iconsInSync = same(haveIcons, wantIcons);
const stylesInSync = same(haveStyles, wantStyles);

const checkOnly = process.argv.includes('--check');

if (modelInSync && iconsInSync && stylesInSync) {
  console.log(
    '[build-client] 内联块已是最新（模型 ' +
      modelLines.length +
      ' 行、图标 ' +
      iconLines.length +
      ' 行、样式 ' +
      styleLines.length +
      ' 行，无需改动）',
  );
  process.exit(0);
}

if (checkOnly) {
  if (!modelInSync) console.error('[build-client] 模型内联块与 zcode-model.js 不一致');
  if (!iconsInSync) console.error('[build-client] 图标内联块与 dsh-icons.js 不一致');
  if (!stylesInSync) console.error('[build-client] 样式内联块与 panel-styles.js 不一致');
  console.error('[build-client] 请运行 node scripts/build-client.mjs');
  process.exit(1);
}

const nextLines = [
  ...clientLines.slice(0, beginIndex + 1),
  ...wantModel,
  ...clientLines.slice(endIndex, iconsBeginIndex + 1),
  ...wantIcons,
  ...clientLines.slice(iconsEndIndex, stylesBeginIndex + 1),
  ...wantStyles,
  ...clientLines.slice(stylesEndIndex),
];
writeFileSync(CLIENT_FILE, nextLines.join('\n') + '\n', 'utf8');
console.log(
  '[build-client] 已内联 模型 ' +
    modelLines.length +
    ' 行' +
    (modelInSync ? '' : '（替换 ' + haveModel.length + '）') +
    '、图标 ' +
    iconLines.length +
    ' 行' +
    (iconsInSync ? '' : '（替换 ' + haveIcons.length + '）') +
    '、样式 ' +
    styleLines.length +
    ' 行' +
    (stylesInSync ? '' : '（替换 ' + haveStyles.length + '）'),
);