/**
 * UX 文件生成器
 * 从解析后的结构回写为 ux 文本
 */
import { ParsedUx, UxComponentNode } from './uxParser';

export interface EditorNodeUpdate {
  nodePath: number[]; // 从根节点开始的子节点索引路径
  type: 'edit' | 'add' | 'delete' | 'move';
  payload: any;
}

export interface StyleUpdate {
  className: string;
  property: string;
  value: string;
}

/**
 * 根据更新指令重新生成 ux 代码（目前版本提供完整模板生成能力，
 * 用于“新建空白页”以及在画布上添加组件后生成代码）
 */
export function generateUxFromTree(template: UxComponentNode,
                                    styleClasses: Record<string, Record<string, string>>,
                                    scriptData: { privateData: Record<string, any>; methods: string[] },
                                    imports: { name: string; src: string }[] = []): string {
  const lines: string[] = [];

  // imports
  for (const imp of imports) {
    lines.push(`<import name="${imp.name}" src="${imp.src}"/>`);
  }
  if (imports.length > 0) lines.push('');

  // template
  lines.push('<template>');
  lines.push(indent(generateNode(template), 2));
  lines.push('</template>');
  lines.push('');

  // script
  lines.push('<script>');
  lines.push(generateScript(scriptData));
  lines.push('</script>');
  lines.push('');

  // style
  lines.push('<style>');
  for (const cls in styleClasses) {
    const props = styleClasses[cls];
    const propLines = Object.keys(props).map(k => `  ${k}: ${props[k]};`);
    lines.push(`  .${cls}{`);
    propLines.forEach(l => lines.push(l));
    lines.push('  }');
  }
  lines.push('</style>');

  return lines.join('\n');
}

function generateNode(node: UxComponentNode, depth: number = 0): string {
  if (node.tag === '#text') {
    return node.textContent || '';
  }

  const parts: string[] = [];
  parts.push(node.tag);

  // attributes
  for (const [k, v] of Object.entries(node.attrs)) {
    parts.push(`${k}="${v}"`);
  }
  // directives
  for (const [k, v] of Object.entries(node.directives)) {
    parts.push(`${k}="${v}"`);
  }
  // events
  for (const [k, v] of Object.entries(node.events)) {
    parts.push(`@${k}="${v}"`);
  }
  // class（从 classNames 恢复）
  if (node.classNames.length > 0 && !('class' in node.attrs)) {
    parts.splice(1, 0, `class="${node.classNames.join(' ')}"`);
  }

  const openTag = `<${parts.join(' ')}>`;

  if (node.children.length === 0 && !node.textContent) {
    return openTag.replace(/>$/, ' />');
  }

  const closeTag = `</${node.tag}>`;

  if (node.textContent && node.children.length === 0) {
    return `${openTag}${node.textContent}${closeTag}`;
  }

  const childLines: string[] = [];
  if (node.textContent) childLines.push(node.textContent);
  for (const child of node.children) {
    childLines.push(generateNode(child, depth + 1));
  }
  return `${openTag}\n${indent(childLines.join('\n'), 2)}\n${closeTag}`;
}

function generateScript(data: { privateData: Record<string, any>; methods: string[] }): string {
  const lines: string[] = [];
  lines.push('export default {');
  lines.push('  private: {');

  const privEntries = Object.entries(data.privateData);
  privEntries.forEach(([k, v], i) => {
    const last = i === privEntries.length - 1;
    let val: string;
    if (typeof v === 'string') {
      val = `"${v.replace(/"/g, '\\"')}"`;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      val = String(v);
    } else if (Array.isArray(v)) {
      val = '[]';
    } else if (v && typeof v === 'object') {
      val = '{}';
    } else {
      val = '""';
    }
    lines.push(`    ${k}: ${val}${last ? '' : ','}`);
  });

  lines.push('  },');

  // 生命周期钩子（通用）
  lines.push('  onInit() {');
  lines.push('  },');

  // methods
  for (const m of data.methods) {
    if (['onInit', 'onShow'].includes(m)) continue;
    lines.push(`  ${m}() {`);
    lines.push('  },');
  }

  lines.push('}');
  return lines.map(l => '  ' + l).join('\n');
}

function indent(str: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return str.split('\n').map(l => pad + l).join('\n');
}

/**
 * 创建一个空的 Vela 页面模板（带 div/text 占位）
 */
export function createEmptyUx(): string {
  return `<template>
  <div class="page">
    <text class="title" value="Hello Vela"/>
  </div>
</template>

<script>
export default {
  private: {
    title: 'Hello'
  },
  onInit() {
  }
}
</script>

<style>
  .page{
    width: 100%;
    height: 100%;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background-color: #000000;
  }
  .title{
    font-size: 30px;
    color: #ffffff;
    font-weight: bold;
  }
</style>
`;
}

/**
 * 常用 Vela 组件模板生成：用于“拖入组件”时生成节点与样式
 */
export const COMPONENT_LIBRARY: Record<string, {
  tag: string;
  defaultClass: string;
  defaultAttrs: Record<string, string>;
  defaultStyles: Record<string, string>;
  label: string;
}> = {
  text: {
    tag: 'text',
    defaultClass: 'comp-text',
    defaultAttrs: { value: '文本' },
    defaultStyles: { 'font-size': '24px', color: '#ffffff' },
    label: '文本'
  },
  div: {
    tag: 'div',
    defaultClass: 'comp-div',
    defaultAttrs: {},
    defaultStyles: {
      width: '100px',
      height: '60px',
      'background-color': '#333333',
      'border-radius': '8px',
      'flex-direction': 'row',
      'justify-content': 'center',
      'align-items': 'center'
    },
    label: '容器 Div'
  },
  image: {
    tag: 'image',
    defaultClass: 'comp-image',
    defaultAttrs: { src: '/common/logo.png' },
    defaultStyles: { width: '60px', height: '60px', 'border-radius': '8px' },
    label: '图片'
  },
  button: {
    tag: 'div', // Vela 用 div+text 组合表示按钮
    defaultClass: 'comp-btn',
    defaultAttrs: {},
    defaultStyles: {
      width: '120px',
      height: '50px',
      'background-color': '#0077ff',
      'border-radius': '16px',
      'justify-content': 'center',
      'align-items': 'center'
    },
    label: '按钮'
  },
  input: {
    tag: 'div',
    defaultClass: 'comp-input',
    defaultAttrs: {},
    defaultStyles: {
      width: '200px',
      height: '50px',
      'background-color': '#1A1A1A',
      'border-radius': '12px',
      'justify-content': 'center',
      'align-items': 'flex-start',
      padding: '5px 10px'
    },
    label: '输入框'
  },
  stack: {
    tag: 'stack',
    defaultClass: 'comp-stack',
    defaultAttrs: {},
    defaultStyles: {
      width: '100%',
      height: '100%',
      'flex-direction': 'column',
      'justify-content': 'flex-start',
      'align-items': 'center',
      'background-color': '#000000'
    },
    label: '堆栈 Stack'
  },
  scroll: {
    tag: 'scroll',
    defaultClass: 'comp-scroll',
    defaultAttrs: { 'scroll-y': 'true' },
    defaultStyles: { width: '100%', flex: '1' },
    label: '滚动区'
  },
  list: {
    tag: 'list',
    defaultClass: 'comp-list',
    defaultAttrs: {},
    defaultStyles: { width: '100%', flex: '1', 'flex-direction': 'column' },
    label: '列表 List'
  }
};
