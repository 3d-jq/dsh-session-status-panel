/**
 * 发布前检查 1/2：未声明标识符。
 *
 * 为什么需要它：面板里 `h(SomeIcon, …)` 用到一个从未声明的标识符时，只有在
 * **该分支真的被渲染到**才会抛 ReferenceError；在 DSH 里表现为 "slot entry crashed"，
 * 条目被框架摘除（本插件遮蔽的宿主 todo dock 会顶回来）。这个检查是穷尽的：
 * 把所有当作组件使用的首字母大写标识符与声明表对账，不依赖渲染路径覆盖。
 *
 * 用法：node scripts/check-identifiers.mjs [目标文件]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = process.argv[2] ?? resolve(here, '../client.js');
const source = readFileSync(FILE, 'utf8');

const declared = new Set();
for (const m of source.matchAll(/(?:^|[\s;{(,])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) declared.add(m[1]);
for (const m of source.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);
for (const m of source.matchAll(/class\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
for (const m of source.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
  for (const part of m[1].split(',')) {
    const name = part.replace(/[={].*$/s, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  }
}
for (const m of source.matchAll(/([A-Za-z_$][\w$]*)\s*=[^=]/g)) declared.add(m[1]);

const usedComponents = new Map();
for (const m of source.matchAll(/\bh\(\s*([A-Z][\w$]*)\s*[,)]/g)) {
  usedComponents.set(m[1], (usedComponents.get(m[1]) ?? 0) + 1);
}

const missing = [...usedComponents.keys()].filter((name) => !declared.has(name));
console.log('[check-identifiers] ' + FILE);
console.log('  作为组件使用的大写标识符：' + usedComponents.size + ' 个');
if (missing.length > 0) {
  console.log('  ❌ 使用了但从未声明：');
  for (const name of missing) console.log('     ' + name + '（' + usedComponents.get(name) + ' 处）');
  process.exitCode = 1;
} else {
  console.log('  ✅ 全部已声明');
}
