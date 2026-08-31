/**
 * Vela JS 可视化编辑器 - VS Code 扩展主入口
 *
 * 功能：
 *  1. 命令激活：右键 ux 文件 / 工具栏按钮 → 打开可视化编辑器
 *  2. 自定义编辑器：vscode.openWith 使用 velaEditor.ux 视图类型
 *  3. 消息通信：extension <-> webview（加载/应用/保存文件）
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { DEVICES, getDeviceById } from './devices';
import { parseUx, toPreviewTree, ParsedUx, extractDirectiveVariables } from './uxParser';
import { createEmptyUx } from './uxGenerator';

const CUSTOM_EDITOR_TYPE = 'velaEditor.ux';
const EDITOR_HTML_PATH = path.join(__dirname, 'webview', 'editor.html');

export function activate(context: vscode.ExtensionContext) {
  // --- 命令：从右键/命令面板打开 ---
  const cmdOpen = vscode.commands.registerCommand(
    'vela-editor.openEditor',
    async (resource?: vscode.Uri) => {
      const uri = resource || getActiveEditorUri();
      if (!uri) {
        vscode.window.showErrorMessage('请先在编辑器中打开一个 .ux 文件，或在资源管理器中选中它。');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith', uri, CUSTOM_EDITOR_TYPE,
        vscode.ViewColumn.Beside
      );
    }
  );
  context.subscriptions.push(cmdOpen);

  // --- 命令：切换设备 ---
  const cmdSwitch = vscode.commands.registerCommand(
    'vela-editor.switchDevice',
    async () => {
      const pick = await vscode.window.showQuickPick(
        DEVICES.map(d => ({
          label: `${d.nameCn}  ·  ${d.width}×${d.height}  ·  ${shapeLabel(d.shape)}`,
          description: d.name,
          id: d.id
        })),
        { placeHolder: '选择要预览的设备型号' }
      );
      if (pick && activePanel) {
        activePanel.webview.postMessage({ type: 'switchDevice', deviceId: pick.id });
      }
    }
  );
  context.subscriptions.push(cmdSwitch);

  // --- 命令：刷新预览 ---
  const cmdRefresh = vscode.commands.registerCommand(
    'vela-editor.refreshPreview',
    () => activePanel?.webview.postMessage({ type: 'refresh' })
  );
  context.subscriptions.push(cmdRefresh);

  // --- 命令：保存修改回文件 ---
  const cmdSave = vscode.commands.registerCommand(
    'vela-editor.saveBack',
    () => { /* 实际保存由 webview 发起消息 */ }
  );
  context.subscriptions.push(cmdSave);

  // --- 自定义编辑器 Provider ---
  const provider = new VelaEditorProvider(context);
  const registration = vscode.window.registerCustomEditorProvider(
    CUSTOM_EDITOR_TYPE,
    provider,
    {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false
    }
  );
  context.subscriptions.push(registration);
}

// 记录当前活动的 webview 面板（用于广播命令）
let activePanel: vscode.WebviewPanel | null = null;

function getActiveEditorUri(): vscode.Uri | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc && doc.fileName.endsWith('.ux')) return doc.uri;
  return undefined;
}

function shapeLabel(s: 'circle' | 'rect' | 'capsule') {
  return s === 'circle' ? '圆形' : s === 'capsule' ? '胶囊形' : '矩形';
}

// =========================================================
// 自定义编辑器 Provider
// =========================================================
class VelaEditorProvider implements vscode.CustomEditorProvider {
  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent>();
  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): vscode.CustomDocument | Thenable<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async saveCustomDocument(
    document: vscode.CustomDocument,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    // 实际的保存由 webview 发起；这里是 VS Code 菜单保存时的兜底
    try {
      // 直接原样写回（编辑器里的最新内容可能是 webview 写回的 applyCode）
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === document.uri.toString());
      if (doc && !doc.isUntitled) {
        await doc.save();
      }
    } catch { /* noop */ }
  }

  async saveCustomDocumentAs(
    document: vscode.CustomDocument,
    destination: vscode.Uri,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    const src = document.uri;
    let content: string;
    try {
      content = fs.readFileSync(src.fsPath, 'utf-8');
    } catch {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === src.toString());
      content = doc?.getText() ?? createEmptyUx();
    }
    fs.writeFileSync(destination.fsPath, content, 'utf-8');
  }

  async revertCustomDocument(
    _document: vscode.CustomDocument,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    // 重新加载由 docChangeHandler 自动完成
  }

  async backupCustomDocument(
    document: vscode.CustomDocument,
    context: vscode.CustomDocumentBackupContext,
    _cancellation: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    // 简单备份：把当前内容写到 destination
    let content: string;
    try {
      content = fs.readFileSync(document.uri.fsPath, 'utf-8');
    } catch {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === document.uri.toString());
      content = doc?.getText() ?? createEmptyUx();
    }
    fs.writeFileSync(context.destination.fsPath, content, 'utf-8');
    return { id: context.destination.toString(), delete: () => { try { fs.unlinkSync(context.destination.fsPath); } catch {} } };
  }

  resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    activePanel = webviewPanel;
    const uri = document.uri;
    const webview = webviewPanel.webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'out', 'webview'))
      ]
    };

    // 构造 webview html
    webview.html = this.buildHtml(webview);

    // 消息处理
    const msgHandler = webview.onDidReceiveMessage(async msg => {
      if (!msg) return;
      switch (msg.type) {
        case 'requestInit':
          this.sendParsedContent(webview, uri);
          break;
        case 'applyCode':
          try {
            await this.applyToEditor(uri, msg.code as string);
            webview.postMessage({ type: 'applyStatus', ok: true });
          } catch (e: any) {
            webview.postMessage({ type: 'applyStatus', ok: false, err: e.message });
          }
          break;
        case 'saveFile':
          try {
            await this.saveFile(uri, msg.code as string);
            webview.postMessage({ type: 'saveStatus', ok: true });
          } catch (e: any) {
            webview.postMessage({ type: 'saveStatus', ok: false, err: e.message });
          }
          break;
      }
    });

    // 文档变化：重新发送（如果用户在文本编辑器中修改了代码）
    const docChangeHandler = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === uri.toString()) {
        // 轻微防抖
        clearTimeout((this as any)._debounce);
        (this as any)._debounce = setTimeout(() => {
          if (webviewPanel.visible) this.sendParsedContent(webview, uri);
        }, 500);
      }
    });

    // 活动状态保持
    const panelVisibleHandler = webviewPanel.onDidChangeViewState(e => {
      if (e.webviewPanel.visible) {
        activePanel = webviewPanel;
        this.sendParsedContent(webview, uri);
      }
    });

    webviewPanel.onDidDispose(() => {
      msgHandler.dispose();
      docChangeHandler.dispose();
      panelVisibleHandler.dispose();
      if (activePanel === webviewPanel) activePanel = null;
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    // 读取模板，把 acquireVsCodeApi 保留（模板已经写好）
    try {
      const htmlPath = EDITOR_HTML_PATH;
      let html = fs.readFileSync(htmlPath, 'utf-8');
      // 如果需要处理 VS Code 资源路径前缀可以在这里扩展
      return html;
    } catch (e) {
      return `<!DOCTYPE html><html><body>
        <h3 style="color:#f48771">无法加载 Vela 编辑器 webview</h3>
        <pre>${(e as Error).message}</pre></body></html>`;
    }
  }

  /** 读取 ux 文件 → 解析 → 发送简化后的渲染树到 webview */
  private sendParsedContent(webview: vscode.Webview, uri: vscode.Uri) {
    let raw = '';
    try {
      raw = fs.readFileSync(uri.fsPath, 'utf-8');
    } catch {
      // 文件可能还没保存到磁盘（未保存的新文档）
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      if (doc) raw = doc.getText();
      else {
        // 兜底：空模板
        raw = createEmptyUx();
      }
    }

    let parsed: ParsedUx | undefined = undefined;
    let styleClassesOut: Record<string, Record<string, string>> = {};
    let previewTree: any = null;
    let directiveVars: any[] = [];
    let scriptDataOut: any = { privateData: {}, methods: [] };
    let importsOut: any[] = [];
    try {
      parsed = parseUx(raw);
      styleClassesOut = parsed.styleClasses;
      scriptDataOut = parsed.scriptData;
      importsOut = parsed.imports || [];
      if (parsed.template) {
        directiveVars = extractDirectiveVariables(parsed.template);
        // 用脚本中的 privateData 初始化数据值
        const initData: Record<string, any> = {};
        directiveVars.forEach(v => {
          if (scriptDataOut.privateData[v.name] !== undefined) {
            initData[v.name] = scriptDataOut.privateData[v.name];
          } else {
            initData[v.name] = v.defaultValue;
          }
        });
        previewTree = toPreviewTree(parsed.template, parsed.styleClasses, initData, initData);
      }
    } catch (e) {
      previewTree = null;
      vscode.window.showWarningMessage(
        `Vela 编辑器：解析 ux 文件失败 (${(e as Error).message})，显示为空白。`
      );
    }

    const defaultDeviceId = vscode.workspace
      .getConfiguration('velaEditor')
      .get<string>('defaultDevice', 'band9pro');

    webview.postMessage({
      type: 'loadContent',
      rawContent: raw,
      uri: uri.toString(),
      tree: previewTree,
      styleClasses: styleClassesOut,
      directiveVars: directiveVars,
      scriptData: scriptDataOut,
      imports: importsOut,
      defaultDeviceId,
      fileExists: fs.existsSync(uri.fsPath)
    });
  }

  /** 把 webview 中生成的代码写回到该 ux 对应的文本编辑器中（未保存到磁盘） */
  private async applyToEditor(uri: vscode.Uri, code: string): Promise<void> {
    // 找到已打开的文本编辑器；否则用 openTextDocument + showTextDocument
    let editor = vscode.window.visibleTextEditors
      .find(e => e.document.uri.toString() === uri.toString());

    if (!editor) {
      const doc = await vscode.workspace.openTextDocument(uri);
      editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    } else {
      await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.One);
    }

    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    await editor.edit(eb => eb.replace(fullRange, code));
  }

  /** 直接写入文件 */
  private async saveFile(uri: vscode.Uri, code: string): Promise<void> {
    const fsUri = uri.scheme === 'file'
      ? uri
      : vscode.Uri.file(uri.fsPath || (vscode.workspace.rootPath ? path.join(vscode.workspace.rootPath, 'untitled.ux') : undefined as any));
    if (!fsUri.fsPath) throw new Error('无法确定保存路径');
    fs.writeFileSync(fsUri.fsPath, code, 'utf-8');
    // 通知 VS Code 刷新
    try { await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer'); } catch {}
  }
}

export function deactivate() {}
