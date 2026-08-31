/**
 * Vela UX 文件解析器
 * 解析 <template>, <script>, <style>, <import> 部分
 */

export interface UxComponentNode {
  tag: string;
  attrs: Record<string, string>;
  directives: Record<string, string>; // if, for, show 等
  events: Record<string, string>;     // @click 等
  textContent?: string;
  children: UxComponentNode[];
  classNames: string[];
  rawContent: string;                 // 原始标签内容（用于回写定位）
  startLine: number;
  endLine: number;
}

export interface UxImport {
  name: string;
  src: string;
}

export interface ParsedUx {
  imports: UxImport[];
  template?: UxComponentNode; // 根节点
  scriptContent: string;      // 原始 script 内容
  styleContent: string;       // 原始 style 内容
  styleClasses: Record<string, Record<string, string>>; // 解析后的 class 样式
  scriptData: {
    privateData: Record<string, any>;
    methods: string[];
  };
  rawContent: string;
}

/**
 * 简易解析 ux 文件（正则 + 行扫描，不依赖外部 XML 解析器）
 */
export function parseUx(content: string): ParsedUx {
  const lines = content.split('\n');
  const result: ParsedUx = {
    imports: [],
    scriptContent: '',
    styleContent: '',
    styleClasses: {},
    scriptData: { privateData: {}, methods: [] },
    rawContent: content
  };

  // 1. 提取 <import name="" src=""/>
  const importRegex = /<import\s+name=["']([^"']+)["']\s+src=["']([^"']+)["']\s*\/?>/g;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    result.imports.push({ name: m[1], src: m[2] });
  }

  // 2. 提取 <template>...</template> 内容
  const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/);
  if (templateMatch) {
    const templateStr = templateMatch[1];
    result.template = parseTemplate(templateStr);
  }

  // 3. 提取 <script>...</script> 内容
  const scriptMatch = content.match(/<script>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    result.scriptContent = scriptMatch[1];
    result.scriptData = parseScript(result.scriptContent);
  }

  // 4. 提取 <style>...</style> 内容
  const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/);
  if (styleMatch) {
    result.styleContent = styleMatch[1];
    result.styleClasses = parseStyleClasses(result.styleContent);
  }

  return result;
}

function parseTemplate(str: string): UxComponentNode {
  // 根节点：取第一个顶层标签
  const trimmed = str.trim();
  return parseNode(trimmed, 0).node;
}

function parseNode(str: string, startLine: number): { node: UxComponentNode; rest: string; endLine: number } {
  str = str.trimStart();
  const tagMatch = str.match(/^<([\#\w][\w-]*)([\s\S]*?)>/);
  if (!tagMatch) {
    // 纯文本内容
    return {
      node: {
        tag: '#text',
        attrs: {},
        directives: {},
        events: {},
        textContent: str.trim(),
        children: [],
        classNames: [],
        rawContent: str,
        startLine,
        endLine: startLine + str.split('\n').length - 1
      },
      rest: '',
      endLine: startLine + str.split('\n').length - 1
    };
  }

  const tag = tagMatch[1];
  const attrStr = tagMatch[2];
  const afterOpen = str.slice(tagMatch[0].length);
  const isSelfClosing = attrStr.trim().endsWith('/');

  const { attrs, directives, events, classNames } = parseAttributes(attrStr);

  const node: UxComponentNode = {
    tag,
    attrs,
    directives,
    events,
    children: [],
    classNames,
    rawContent: tagMatch[0],
    startLine,
    endLine: startLine
  };

  if (isSelfClosing) {
    node.endLine = startLine;
    return { node, rest: afterOpen, endLine: startLine };
  }

  // 递归解析子节点，直到匹配的 </tag>
  let rest = afterOpen;
  let line = startLine;
  const children: UxComponentNode[] = [];
  const closeRegexStr = `</${tag}\\s*>`;
  const closeRegex = new RegExp(closeRegexStr);

  while (rest.length > 0) {
    const trimmed = rest.trimStart();
    const lineOffset = rest.length - trimmed.length;
    line += countLines(rest.slice(0, lineOffset));
    rest = trimmed;

    if (rest.length === 0) break;

    // 检查是否到达关闭标签
    const closeMatch = rest.match(new RegExp('^' + closeRegexStr));
    if (closeMatch) {
      rest = rest.slice(closeMatch[0].length);
      line += countLines(closeMatch[0]);
      node.children = children;
      node.endLine = line;
      return { node, rest, endLine: line };
    }

    // 检查是否有文本内容在关闭标签之前
    const restForSearch = rest.slice(0, 5000); // limit search
    const searchRegex = new RegExp(closeRegexStr);
    const closeIdx = restForSearch.search(searchRegex);

    // 如果下一个标签不是关闭标签，而是一个子标签，则先解析子标签
    const nextTagMatch = rest.match(/^<([\#\w][\w-]*)([\s\S]*?)>/);
    if (nextTagMatch) {
      // 在解析子标签之前，检查是否有前置文本
      const textBeforeTag = rest.slice(0, nextTagMatch.index || 0);
      if (textBeforeTag && textBeforeTag.trim()) {
        children.push({
          tag: '#text',
          attrs: {},
          directives: {},
          events: {},
          textContent: textBeforeTag.trim(),
          children: [],
          classNames: [],
          rawContent: textBeforeTag.trim(),
          startLine: line,
          endLine: line + countLines(textBeforeTag)
        });
        rest = rest.slice(textBeforeTag.length);
        line += countLines(textBeforeTag);
        continue;
      }

      // 解析子节点
      const { node: child, rest: newRest, endLine: childEndLine } = parseNode(rest, line);
      if (child.tag !== '#text' || child.textContent) {
        children.push(child);
      }
      rest = newRest;
      line = childEndLine;
      continue;
    }

    // 没有子标签 → 剩余内容可能是文本或关闭标签
    if (closeIdx !== -1) {
      // 关闭标签前有文本
      const textContent = rest.slice(0, closeIdx).trim();
      if (textContent) {
        children.push({
          tag: '#text',
          attrs: {},
          directives: {},
          events: {},
          textContent: textContent,
          children: [],
          classNames: [],
          rawContent: textContent,
          startLine: line,
          endLine: line + countLines(textContent)
        });
      }
      rest = rest.slice(closeIdx);
      line += countLines(rest.slice(0, closeIdx));
      continue;
    }

    // 没有关闭标签也没有子标签 → 当作文本
    const allText = rest.trim();
    if (allText) {
      children.push({
        tag: '#text',
        attrs: {},
        directives: {},
        events: {},
        textContent: allText,
        children: [],
        classNames: [],
        rawContent: allText,
        startLine: line,
        endLine: line + countLines(rest)
      });
    }
    rest = '';
  }

  node.children = children;
  node.endLine = line;
  return { node, rest, endLine: line };
}

function parseAttributes(attrStr: string): {
  attrs: Record<string, string>;
  directives: Record<string, string>;
  events: Record<string, string>;
  classNames: string[];
} {
  const attrs: Record<string, string> = {};
  const directives: Record<string, string> = {};
  const events: Record<string, string> = {};
  let classNames: string[] = [];

  // 匹配 attr="value" 或 attr='value' 或 attr={{expr}} 或 @click="fn" 或 if="{{expr}}" 等
  const attrRegex = /(@?[\w-]+)\s*=\s*(?:["']([^"']*)["']|(\{\{[^}]*\}\}))/g;
  let match;
  while ((match = attrRegex.exec(attrStr)) !== null) {
    const key = match[1];
    const value = match[2] || match[3] || '';
    if (key.startsWith('@')) {
      events[key.slice(1)] = value;
    } else if (['if', 'for', 'show'].includes(key)) {
      directives[key] = value;
    } else {
      attrs[key] = value;
      if (key === 'class') {
        classNames = value.replace(/\{\{[^}]*\}\}/g, '').trim().split(/\s+/).filter(Boolean);
      }
    }
  }

  return { attrs, directives, events, classNames };
}

function parseScript(content: string): { privateData: Record<string, any>; methods: string[] } {
  const privateData: Record<string, any> = {};
  const methods: string[] = [];

  // 提取 private 对象内容（使用大括号计数）
  const privateStartMatch = content.match(/private\s*:\s*\{/);
  if (privateStartMatch) {
    const startIdx = privateStartMatch.index! + privateStartMatch[0].length;
    let braceCount = 1;
    let endIdx = startIdx;
    for (let i = startIdx; i < content.length && braceCount > 0; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      endIdx = i + 1;
    }
    const privStr = content.slice(startIdx, endIdx - 1);
    // 逐行提取 "key: value"，但处理跨多行的对象/数组
    const lines = privStr.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      // 跳过空行
      if (!line) { i++; continue; }

      // 匹配 key: value 或 key: { / key: [
      const kvMatch = line.match(/^(\w+)\s*:\s*(.*)/);
      if (!kvMatch) { i++; continue; }

      const key = kvMatch[1];
      let val = kvMatch[2].trim();

      // 如果值以 { 或 [ 开头，需要收集到匹配的 } 或 ]
      if (val === '{' || val === '[') {
        const isObj = val === '{';
        let braceCount = 1;
        let fullVal = val;
        while (i + 1 < lines.length && braceCount > 0) {
          i++;
          fullVal += '\n' + lines[i];
          for (const ch of lines[i]) {
            if (ch === (isObj ? '{' : '[')) braceCount++;
            if (ch === (isObj ? '}' : ']')) braceCount--;
          }
        }
        val = fullVal.trim();
      } else if (val.endsWith('{') || val.endsWith('[')) {
        // 同一行开始但未闭合
        const isObj = val.endsWith('{');
        val = val.slice(0, -1).trim();
        if (val.endsWith(',')) val = val.slice(0, -1).trim();
        let braceCount = 1;
        let fullVal = isObj ? '{' : '[';
        while (i + 1 < lines.length && braceCount > 0) {
          i++;
          fullVal += '\n' + lines[i];
          for (const ch of lines[i]) {
            if (ch === (isObj ? '{' : '[')) braceCount++;
            if (ch === (isObj ? '}' : ']')) braceCount--;
          }
        }
        val = fullVal.trim();
      }

      // 解析值
      try {
        if (val.startsWith('"') || val.startsWith("'")) {
          privateData[key] = val.slice(1, -1);
        } else if (val === 'true' || val === 'false') {
          privateData[key] = val === 'true';
        } else if (val === '[]' || /^\[\s*\]$/.test(val)) {
          privateData[key] = [];
        } else if (val === '{}' || /^\{\s*\}$/.test(val)) {
          privateData[key] = {};
        } else if (/^[\d.]+$/.test(val)) {
          privateData[key] = Number(val);
        } else if (val.startsWith('{') || val.startsWith('[')) {
          // 对象或数组，存储为字符串
          privateData[key] = val;
        } else {
          // 去掉尾部逗号
          let cleanVal = val;
          if (cleanVal.endsWith(',')) cleanVal = cleanVal.slice(0, -1).trim();
          if (cleanVal === 'true' || cleanVal === 'false') {
            privateData[key] = cleanVal === 'true';
          } else if (/^[\d.]+$/.test(cleanVal)) {
            privateData[key] = Number(cleanVal);
          } else {
            privateData[key] = cleanVal;
          }
        }
      } catch {
        privateData[key] = val;
      }
      i++;
    }
  }

  // 提取方法名（简单匹配 key() {
  const methodRegex = /(\w+)\s*\([^)]*\)\s*\{/g;
  let mm;
  while ((mm = methodRegex.exec(content)) !== null) {
    if (!['if', 'for', 'while', 'catch', 'switch'].includes(mm[1])) {
      methods.push(mm[1]);
    }
  }

  return { privateData, methods };
}

function parseStyleClasses(styleContent: string): Record<string, Record<string, string>> {
  const classes: Record<string, Record<string, string>> = {};
  // 匹配 .className { ... }
  const classRegex = /\.([\w-]+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = classRegex.exec(styleContent)) !== null) {
    const name = match[1];
    const body = match[2];
    const props: Record<string, string> = {};
    body.split(';').forEach(decl => {
      const idx = decl.indexOf(':');
      if (idx > 0) {
        const prop = decl.slice(0, idx).trim();
        const val = decl.slice(idx + 1).trim();
        if (prop && val) props[prop] = val;
      }
    });
    classes[name] = props;
  }
  return classes;
}

function countLines(str: string): number {
  return (str.match(/\n/g) || []).length;
}

/**
 * 解析 if 表达式，提取变量名和比较值
 * 支持的格式：
 *   {{var}}              -> 变量 truthy 检查
 *   {{var===N}}          -> 数值比较 (N 可以是 1,2,3,...)
 *   {{var===N&&...}}     -> 复合条件
 *   {{var===N||...}}     -> 复合条件
 *   纯 true/false/1/0    -> 字面量
 */
function parseIfExpression(val: string): { variable: string; compareValue: string | null; raw: string; kind?: string } | null {
  if (!val) return null;
  const expr = val.trim();

  // 直接的字面量 true/false/1/0
  if (expr === 'true' || expr === '1') return { variable: '__literal__', compareValue: 'true', raw: expr, kind: 'literal' };
  if (expr === 'false' || expr === '0' || expr === '') return { variable: '__literal__', compareValue: 'false', raw: expr, kind: 'literal' };

  // {{...}} 模板表达式
  const tmplMatch = expr.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (!tmplMatch) return null;

  const inner = tmplMatch[1].trim();

  // 逻辑复合表达式（包含 && 或 ||）—— 优先检测
  if (inner.includes('&&') || inner.includes('||')) {
    return { variable: '__complex__', compareValue: null, raw: inner, kind: 'complex' };
  }

  // 处理 !var
  const notMatch = inner.match(/^!\s*(\w+)$/);
  if (notMatch) return { variable: notMatch[1], compareValue: null, raw: inner, kind: 'not' };

  // 简单变量：{{var}}
  const simpleVar = inner.match(/^(\w+)\s*$/);
  if (simpleVar) return { variable: simpleVar[1], compareValue: null, raw: inner, kind: 'variable' };

  // 等值比较：{{var===value}} 或 {{var==value}}
  const eqMatch = inner.match(/^(\w+)\s*=?==\s*(.+)$/);
  if (eqMatch) {
    const varName = eqMatch[1];
    let cmpVal = eqMatch[2].trim();
    if ((cmpVal.startsWith('"') && cmpVal.endsWith('"')) ||
        (cmpVal.startsWith("'") && cmpVal.endsWith("'"))) {
      cmpVal = cmpVal.slice(1, -1);
    }
    return { variable: varName, compareValue: cmpVal, raw: inner, kind: 'compare' };
  }

  return { variable: '__unknown__', compareValue: null, raw: inner, kind: 'unknown' };
}

/**
 * 评估 if/show 表达式，传入实际数据值
 */
export function evaluateDirectiveWithData(val: string, data: Record<string, any>): boolean {
  if (!val) return true;
  const parsed = parseIfExpression(val);
  if (!parsed) return true;

  // 字面量
  if (parsed.variable === '__literal__') {
    return parsed.compareValue === 'true';
  }

  // 处理 !var
  if (parsed.kind === 'not') {
    const v = data[parsed.variable];
    return !v;
  }

  // 简单变量：{{var}}
  if (parsed.variable !== '__complex__' && parsed.variable !== '__unknown__' && parsed.compareValue === null) {
    const val = data[parsed.variable];
    if (val === undefined || val === null) return false;
    return Boolean(val);
  }

  // 比较表达式：{{var===value}}
  if (parsed.compareValue !== null) {
    const val = data[parsed.variable];
    if (val === undefined) return false;
    // 尝试数值比较
    const numVal = Number(val);
    const numCmp = Number(parsed.compareValue);
    if (!isNaN(numVal) && !isNaN(numCmp)) {
      return numVal === numCmp;
    }
    return String(val) === parsed.compareValue;
  }

  // 复合表达式：{{var===value&&...}}
  if (parsed.raw) {
    try {
      return evaluateComplexExpression(parsed.raw, data);
    } catch {
      return true;
    }
  }

  return true;
}

/**
 * 评估复合表达式，支持 && || === ! 和 ()
 */
function evaluateComplexExpression(expr: string, data: Record<string, any>): boolean {
  // 转换 Vela 表达式为 JS 表达式
  // 1. 替换 {{...}} 为实际值
  let jsExpr = expr.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, inner) => {
    return String(inner);
  });

  // 2. 处理 ! 否定
  jsExpr = jsExpr.replace(/!\s*(\w+)/g, (_, varName) => {
    const val = data[varName];
    return !val ? 'true' : 'false';
  });

  // 3. 处理 变量 直接引用（没有 === 的情况）
  // 先提取所有变量，替换为实际值
  const varRegex = /\b(\w+)\b/g;
  const varNames = new Set<string>();
  jsExpr.match(varRegex)?.forEach(m => {
    if (!['true', 'false', '&&', '||', '===', '==', '!=', '!', '(', ')'].includes(m)) {
      varNames.add(m);
    }
  });

  // 替换变量为值
  varNames.forEach(name => {
    const val = data[name];
    if (val !== undefined) {
      const jsVal = typeof val === 'string' ? `"${val}"` : JSON.stringify(val);
      jsExpr = jsExpr.replace(new RegExp(`\\b${name}\\b`, 'g'), jsVal);
    } else {
      jsExpr = jsExpr.replace(new RegExp(`\\b${name}\\b`, 'g'), 'null');
    }
  });

  // 4. 安全评估
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${jsExpr});`)();
    return Boolean(result);
  } catch {
    return true;
  }
}

/**
 * 递归提取所有 if/show 指令中使用的变量
 */
export function extractDirectiveVariables(root: UxComponentNode): Array<{
  name: string;
  type: 'boolean' | 'number' | 'string' | 'any';
  defaultValue: any;
  usedInIf: boolean;
  usedInShow: boolean;
  compareValues: string[];
}> {
  const varMap = new Map<string, {
    name: string;
    type: 'boolean' | 'number' | 'string' | 'any';
    defaultValue: any;
    usedInIf: boolean;
    usedInShow: boolean;
    compareValues: string[];
  }>();

  function walk(node: UxComponentNode) {
    const directives = node.directives || {};

    for (const [dirName, dirValue] of Object.entries(directives)) {
      const isIf = dirName === 'if';
      const isShow = dirName === 'show';
      if (!isIf && !isShow) continue;

      const parsed = parseIfExpression(dirValue);
      if (!parsed) continue;

      if (parsed.variable === '__literal__') continue;

      if (parsed.variable === '__complex__' || parsed.variable === '__unknown__') {
        // 复合表达式：尝试提取所有变量及其比较值
        const varNames = extractVarsFromComplex(parsed.raw);
        // 尝试从复合表达式中提取 {{var===value}} 模式
        const cmpMatches = parsed.raw.matchAll(/(\w+)\s*=?==\s*([^&\s|)]+)/g);
        const cmpMap = new Map<string, string[]>();
        for (const cm of cmpMatches) {
          const vn = cm[1];
          const cv = cm[2].trim();
          if (!cmpMap.has(vn)) cmpMap.set(vn, []);
          cmpMap.get(vn)!.push(cv);
        }
        for (const v of varNames) {
          if (!varMap.has(v)) {
            varMap.set(v, { name: v, type: 'any', defaultValue: false, usedInIf: false, usedInShow: false, compareValues: [] });
          }
          const entry = varMap.get(v)!;
          if (isIf) entry.usedInIf = true;
          if (isShow) entry.usedInShow = true;
          // 从复合表达式中收集比较值
          if (cmpMap.has(v)) {
            for (const cv of cmpMap.get(v)!) {
              if (!entry.compareValues.includes(cv)) {
                entry.compareValues.push(cv);
              }
            }
            // 根据比较值推断类型
            if (entry.type === 'any' && cmpMap.get(v)!.length > 0) {
              const firstCmp = cmpMap.get(v)![0];
              const numVal = Number(firstCmp);
              if (!isNaN(numVal)) {
                entry.type = 'number';
                entry.defaultValue = 0;
              } else if (firstCmp === 'true' || firstCmp === 'false') {
                entry.type = 'boolean';
                entry.defaultValue = firstCmp === 'true';
              }
            }
          }
        }
      } else if (parsed.kind === 'not') {
        // !var → 布尔型
        const varName = parsed.variable;
        if (!varMap.has(varName)) {
          varMap.set(varName, { name: varName, type: 'boolean', defaultValue: false, usedInIf: false, usedInShow: false, compareValues: [] });
        }
        const entry = varMap.get(varName)!;
        if (isIf) entry.usedInIf = true;
        if (isShow) entry.usedInShow = true;
      } else {
        const varName = parsed.variable;
        if (!varMap.has(varName)) {
          varMap.set(varName, {
            name: varName,
            type: 'any',
            defaultValue: false,
            usedInIf: false,
            usedInShow: false,
            compareValues: []
          });
        }
        const entry = varMap.get(varName)!;
        if (isIf) entry.usedInIf = true;
        if (isShow) entry.usedInShow = true;

        if (parsed.compareValue !== null) {
          entry.compareValues.push(parsed.compareValue);
          // 根据比较值推断类型
          const numVal = Number(parsed.compareValue);
          if (!isNaN(numVal)) {
            entry.type = 'number';
            entry.defaultValue = 0;
          } else if (parsed.compareValue === 'true' || parsed.compareValue === 'false') {
            entry.type = 'boolean';
            entry.defaultValue = parsed.compareValue === 'true';
          } else {
            entry.type = 'string';
            entry.defaultValue = parsed.compareValue;
          }
        } else {
          // 简单变量 {{var}} → 布尔
          if (entry.type === 'any') {
            entry.type = 'boolean';
            entry.defaultValue = false;
          }
        }
      }
    }

    (node.children || []).forEach(walk);
  }

  walk(root);
  return Array.from(varMap.values());
}

/**
 * 从复合表达式中提取变量名
 */
function extractVarsFromComplex(expr: string): string[] {
  const vars = new Set<string>();
  // 提取所有 \w+ 标识符（表达式可能已去掉 {{}} 包裹）
  const idRegex = /[a-zA-Z_]\w*/g;
  let idm;
  while ((idm = idRegex.exec(expr)) !== null) {
    const name = idm[0];
    if (!['true', 'false', '&&', '||', '!', '(', ')', '===', '==', '!=', '>=' , '<=', '>', '<'].includes(name)) {
      vars.add(name);
    }
  }
  // 也处理 !var 形式
  const notRegex = /!\s*([a-zA-Z_]\w*)/g;
  let nm;
  while ((nm = notRegex.exec(expr)) !== null) {
    vars.add(nm[1]);
  }
  return Array.from(vars);
}

/**
 * 将 UxComponentNode 渲染树转换为预览用的简化结构
 */
export function toPreviewTree(node: UxComponentNode, styleClasses: Record<string, Record<string, string>>, data: Record<string, any> = {}, evalData?: Record<string, any>): any {
  if (node.tag === '#text') {
    return { type: 'text', tag: 'text', __comp: 'text', content: node.textContent || '', directives: {} };
  }

  const mergedStyles: Record<string, string> = {};
  node.classNames.forEach(cls => {
    if (styleClasses[cls]) {
      Object.assign(mergedStyles, styleClasses[cls]);
    }
  });

  // 处理数据绑定：{{expr}} -> 对应 data 值或原样保留
  const resolveBinding = (val: string): string => {
    if (!val) return '';
    return val.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, expr) => {
      const key = expr.trim();
      if (data[key] !== undefined) return String(data[key]);
      if (evalData && evalData[key] !== undefined) return String(evalData[key]);
      return '{{' + key + '}}';
    });
  };

  const directives = { ...node.directives };
  const hasIf = 'if' in directives;
  const hasShow = 'show' in directives;

  // 使用 evalData（用户编辑的数据）进行评估，如无则用原始数据
  const useData = evalData || data;
  const ifVal = hasIf ? evaluateDirectiveWithData(directives['if'], useData) : true;
  const showVal = hasShow ? evaluateDirectiveWithData(directives['show'], useData) : true;

  const ifResult = { visible: ifVal, parsed: parseIfExpression(hasIf ? directives['if'] : '') };
  const showResult = { visible: showVal, parsed: parseIfExpression(hasShow ? directives['show'] : '') };

  const visible = ifResult.visible && showResult.visible;

  const resolvedAttrs: Record<string, string> = {};
  for (const k in node.attrs) {
    resolvedAttrs[k] = resolveBinding(node.attrs[k]);
  }

  const tag = node.tag;
  const __comp = mapTagToComponent(tag, node.classNames, mergedStyles);

  return {
    type: tag,
    tag: tag,
    __comp: __comp,
    attrs: resolvedAttrs,
    directives: directives,
    events: node.events,
    classNames: node.classNames,
    styles: mergedStyles,
    visible: visible,
    _if: hasIf ? ifResult.visible : null,
    _ifParsed: ifResult.parsed,
    _show: hasShow ? showResult.visible : null,
    _showParsed: showResult.parsed,
    children: node.children.map(c => toPreviewTree(c, styleClasses, data, evalData))
  };
}

/**
 * 将 Vela 原生标签映射为编辑器的组件类型（用于树显示和属性面板）
 */
function mapTagToComponent(tag: string, classNames: string[], styles: Record<string, string>): string {
  if (tag === 'text') {
    // 根据样式判断是标题、时间、还是普通文本
    const fontSize = styles['font-size'] || '';
    const isBold = styles['font-weight'] === 'bold';
    if (isBold && (fontSize === '30px' || fontSize === '28px')) return 'title';
    if (fontSize === '28px' && isBold) return 'time';
    return 'text';
  }
  if (tag === 'div') {
    // 如果有内容可以视为按钮
    const bg = styles['background-color'] || '';
    const w = styles['width'] || '';
    const h = styles['height'] || '';
    // 如果有子 text 元素，可能是按钮/输入容器
    return 'div';
  }
  return tag;
}
