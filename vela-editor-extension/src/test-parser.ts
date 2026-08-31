/**
 * 简易自测脚本：验证 uxParser 能解析用户提供的 index.ux 示例
 * 运行: node out/test-parser.js
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseUx, toPreviewTree } from './uxParser';

function main() {
  const samplePath = path.resolve(__dirname, '..', '..', 'index.ux');
  console.log('解析文件:', samplePath);
  if (!fs.existsSync(samplePath)) {
    console.error('  ❌ 找不到 index.ux 示例文件');
    process.exit(1);
  }
  const raw = fs.readFileSync(samplePath, 'utf-8');
  console.log(`  文件大小: ${raw.length} 字符`);

  try {
    const parsed = parseUx(raw);
    console.log(`  ✅ 解析成功`);
    console.log(`    - import 数量: ${parsed.imports.length}`);
    parsed.imports.forEach(im => console.log(`        · <import name="${im.name}" src="${im.src}">`));
    console.log(`    - template 根节点: <${parsed.template?.tag || '(无)'}>`);
    const countEls = countNodes(parsed.template);
    console.log(`    - 元素总数: ${countEls}`);
    console.log(`    - 样式类数量: ${Object.keys(parsed.styleClasses).length}`);
    console.log(`    - 样式类名: ${Object.keys(parsed.styleClasses).slice(0, 10).join(', ')}${Object.keys(parsed.styleClasses).length > 10 ? ' ...' : ''}`);
    console.log(`    - script private keys: ${Object.keys(parsed.scriptData.privateData).slice(0, 10).join(', ')}`);
    console.log(`    - script methods: ${parsed.scriptData.methods.slice(0, 10).join(', ')}${parsed.scriptData.methods.length > 10 ? ' ...' : ''}`);

    // 转预览树
    const preview = toPreviewTree(
      parsed.template!,
      parsed.styleClasses,
      parsed.scriptData.privateData
    );
    console.log(`    ✅ toPreviewTree 转换成功，根类型=${preview.type}`);

    // 深度统计：styleClasses 是否能合并到节点
    const stack = parsed.template?.children?.[0]?.children?.find(c => c.tag === 'div' && c.classNames.includes('main'));
    if (stack) {
      const mainStyles = stack.classNames
        .map(cls => [cls, parsed.styleClasses[cls]])
        .filter(([, v]) => v) as [string, Record<string,string>][];
      console.log(`    - 节点 .main 应用样式类: ${mainStyles.map(([k]) => k).join(', ')}`);
      const merged: Record<string,string> = {};
      mainStyles.forEach(([, s]) => Object.assign(merged, s));
      console.log(`      合并后样式属性数: ${Object.keys(merged).length}, bg-color=${merged['background-color'] || '(未设置)'}`);
    }

    console.log('\n🎉 解析器自测通过');
  } catch (e) {
    console.error('  ❌ 解析失败', (e as Error).stack || (e as Error).message);
    process.exit(1);
  }
}

function countNodes(n: any): number {
  if (!n) return 0;
  let c = 1;
  (n.children || []).forEach((ch: any) => { c += countNodes(ch); });
  return c;
}

main();
