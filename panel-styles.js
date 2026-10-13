/**
 * 面板样式表 —— CSS 文本随组件渲染成 <style> 元素，卸载即移除。
 *
 * 为什么这样做（而不是继续内联 style）：
 *   - 规范要求插件自带 CSS 文本、用插件前缀类名、只引用 --dsw-* 令牌
 *     （cordis-plugin-development/references/practices.md:35）；
 *   - 规范明确"Component-local styles can render as React elements so unmounting
 *     removes them"（references/ui-plugin.md:13），所以插件不需要构建步骤
 *     （浏览器半区是手写 JS，无法 import './x.css'）。
 *
 * 本表只包含**动态类名**（hover / 过渡 / 动画）；布局仍走内联 style，
 * 因为那是每个元素各自的度量，CSS 化对可读性没有净收益。
 */

/** 面板唯一的一处样式文本（类名全部带 dssp- 前缀，令牌只来自 --dsw-*）。 */
export const PANEL_CSS = `
.dssp-row { transition: background-color 120ms ease; }
.dssp-row:enabled:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dssp-row:disabled { cursor: default; }

.dssp-icon-btn { transition: background-color 120ms ease, color 120ms ease; }
.dssp-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.dssp-section { animation: dssp-fade-in 160ms ease-in-out; }
@keyframes dssp-fade-in { from { opacity: 0; } to { opacity: 1; } }

/* 折叠内容展开：高度 + 透明度（对齐 ZCode Collapsible 的 animate-collapsible-down 语义） */
.dssp-collapse { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 200ms ease; }
.dssp-collapse[data-open="true"] { grid-template-rows: 1fr; }
.dssp-collapse > * { overflow: hidden; opacity: 0; transition: opacity 160ms ease; }
.dssp-collapse[data-open="true"] > * { opacity: 1; transition-delay: 60ms; }
@media (prefers-reduced-motion: reduce) {
  .dssp-collapse, .dssp-collapse > *, .dssp-row, .dssp-icon-btn { transition: none; }
  .dssp-section { animation: none; }
}

/* 胶囊：悬停时主图标与"展开"图标交叉淡入（ZCode 的 Maximize2 hover 切换） */
.dssp-capsule { position: relative; }
.dssp-capsule .dssp-icon-a,
.dssp-capsule .dssp-icon-b { transition: opacity 120ms ease; }
.dssp-capsule .dssp-icon-b { position: absolute; inset: 0; opacity: 0; }
.dssp-capsule:hover .dssp-icon-a, .dssp-capsule:focus-visible .dssp-icon-a { opacity: 0; }
.dssp-capsule:hover .dssp-icon-b, .dssp-capsule:focus-visible .dssp-icon-b { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .dssp-capsule .dssp-icon-a, .dssp-capsule .dssp-icon-b { transition: none; }
}
`;