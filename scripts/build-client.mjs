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
const CLIENT_FILE = resolve(root, 'client.js');

const BEGIN_TEXT = '// __ZCODE_MODEL_BEGIN__';
const END_TEXT = '// __ZCODE_MODEL_END__';

const isMarker = (line, text) => line.trim() === text;

const modelLines = readFileSync(MODEL_FILE, 'utf8').replace(/\s+$/, '').split('\n');
const clientText = readFileSync(CLIENT_FILE, 'utf8');
const hadFinalNewline = clientText.endsWith('\n');
const clientLines = clientText.split('\n');

const beginIndex = clientLines.findIndex((line) => isMarker(line, BEGIN_TEXT));
const endIndex = clientLines.findIndex((line) => isMarker(line, END_TEXT));
if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
  throw new Error('client.js 里找不到成对的 ' + BEGIN_TEXT + ' / ' + END_TEXT + ' 标记行');
}

const indent = (clientLines[beginIndex].match(/^[ \t]*/) || [''])[0];
const indentModel = modelLines.map((line) => (line.length > 0 ? indent + line : line));

const currentBody = clientLines.slice(beginIndex + 1, endIndex);
const inSync =
  currentBody.length === indentModel.length && currentBody.every((line, i) => line === indentModel[i]);

const checkOnly = process.argv.includes('--check');

if (inSync) {
  console.log('[build-client] 内联块已是最新（' + modelLines.length + ' 行模型，无需改动）');
  process.exit(0);
}

if (checkOnly) {
  console.error('[build-client] 内联块与 zcode-model.js 不一致：请运行 node scripts/build-client.mjs');
  process.exit(1);
}

const nextLines = [
  ...clientLines.slice(0, beginIndex + 1),
  ...indentModel,
  ...clientLines.slice(endIndex),
];
writeFileSync(CLIENT_FILE, nextLines.join('\n') + (hadFinalNewline ? '' : ''), 'utf8');
console.log(
  '[build-client] 已内联 ' + modelLines.length + ' 行模型（替换 ' + currentBody.length + ' 行）',
);