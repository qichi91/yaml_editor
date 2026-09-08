import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { SchemaManager } from './schemaManager';
import { MarkdownGenerator } from './markdownGenerator';
import { SpecData, TableSchema } from './types';

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Table Spec Editor');
  context.subscriptions.push(output);
  const log = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    output.appendLine(line);
    console.log(`[Table Spec Editor] ${message}`);
  };

  log(`拡張機能activate: ${context.extensionPath}`);
  log(`workspaceFolders: ${vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath).join(', ') || '(なし)'}`);

  const schemaManager = new SchemaManager(output);
  await schemaManager.loadAllSchemas();
  log(`初期スキーマ読み込み後: ${schemaManager.getAllSchemaIds().join(', ') || '(なし)'}`);

  // スキーマファイルが編集されたら再ロード
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.schema.yaml');
  watcher.onDidChange(uri => {
    log(`スキーマ変更検知: ${uri.fsPath}`);
    void schemaManager.loadAllSchemas();
  });
  watcher.onDidCreate(uri => {
    log(`スキーマ作成検知: ${uri.fsPath}`);
    void schemaManager.loadAllSchemas();
  });
  context.subscriptions.push(watcher);

  // カスタムエディタ登録
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('tableSpec.editor', {
      async resolveCustomTextEditor(document, webviewPanel) {
        log(`カスタムエディタ解決: ${document.uri.fsPath}`);
        webviewPanel.webview.options = { enableScripts: true };

        const htmlPath = path.join(context.extensionPath, 'media', 'editor.html');
        webviewPanel.webview.html = fs.readFileSync(htmlPath, 'utf8');

        // YAMLパース
        function parseDocument(): SpecData {
          const text = document.getText();
          if (text.trim().length === 0) {
            return { schema: '', items: [] };
          }
          return yaml.load(text) as SpecData;
        }

        // Webviewへデータ・スキーマ送信
        function syncToWebview() {
          try {
            const data = parseDocument();
            const registeredSchema = schemaManager.getSchema(data.schema);
            const schema = registeredSchema || schemaManager.getFallbackSchema();
            const availableSchemas = schemaManager.getAllSchemaIds();
            log(`Webview初期化: schema=${data.schema || '(未指定)'}, `
              + `解決結果=${registeredSchema?.schema_id || 'fallback'}, `
              + `利用可能=${availableSchemas.join(', ') || '(なし)'}`);
            webviewPanel.webview.postMessage({
              type: 'init',
              schema,
              data,
              availableSchemas
            });
          } catch (err: any) {
            log(`YAMLパース失敗: ${err.message}`);
            vscode.window.showErrorMessage('YAMLのパースに失敗しました: ' + err.message);
          }
        }

        // Webviewからのデータ更新（Undo/Redo・未保存フラグ反映）
        webviewPanel.webview.onDidReceiveMessage(async message => {
          log(`Webviewメッセージ: ${message.type || '(typeなし)'}`);
          if (message.type === 'ready') {
            log('Webview準備完了、初期データを再送信');
            syncToWebview();
            return;
          }
          if (message.type === 'change') {
            const currentData = parseDocument();
            const incomingData = message.data as SpecData;
            const schemaChanged = currentData.schema !== incomingData.schema;

            // スキーマ変更時対応: 画面上にない旧列キー・未定義属性を保持してマージ
            const mergedItems = incomingData.items.map((newItem, idx) => {
              const oldItem = currentData.items?.[idx] || {};
              // oldItem のキーをベースに newItem で上書き（旧列データを消さずに温存）
              return { ...oldItem, ...newItem };
            });

            const finalData: SpecData = {
              ...currentData,
              ...incomingData,
              items: mergedItems
            };

            for (const subtable of schemaManager.getSchema(incomingData.schema)?.subtables || []) {
              const incomingSubtableItems = Array.isArray(incomingData[subtable.data_key])
                ? incomingData[subtable.data_key]
                : [];
              const oldSubtableItems = Array.isArray(currentData[subtable.data_key])
                ? currentData[subtable.data_key]
                : [];
              finalData[subtable.data_key] = incomingSubtableItems.map((newItem: Record<string, any>, idx: number) => ({
                ...oldSubtableItems[idx],
                ...newItem
              }));
            }

            // YAMLキー順保持 (sortKeys: false)
            const yamlText = yaml.dump(finalData, {
              sortKeys: false,
              lineWidth: -1,
              quotingType: '"',
              forceQuotes: false
            });

            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), yamlText);
            await vscode.workspace.applyEdit(edit);
            log(`YAML更新適用: ${document.uri.fsPath}, items=${mergedItems.length}`);
            if (schemaChanged) {
              log(`スキーマ変更、Webviewを再同期: ${currentData.schema || '(未指定)'} -> ${incomingData.schema || '(未指定)'}`);
              syncToWebview();
            }
          }
        });

        webviewPanel.onDidChangeViewState(event => {
          if (event.webviewPanel.visible) {
            log('Webview再表示、初期データを再同期');
            syncToWebview();
          }
        });

        syncToWebview();
      }
    })
  );

  // 【保存時のみ実行】ファイル保存時フックでMarkdownを同期生成
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async document => {
      if (document.fileName.endsWith('.spec.yaml') || document.fileName.endsWith('.spec.yml')) {
        try {
          log(`保存検知: ${document.fileName}`);
          const text = document.getText();
          const data = yaml.load(text) as SpecData;
          if (!data || !data.schema) {
            log('Markdown生成スキップ: schema未指定');
            return;
          }

          const schema = schemaManager.getSchema(data.schema);
          if (!schema) {
            log(`Markdown生成スキップ: 未登録schema=${data.schema}`);
            return;
          }

          const mdContent = MarkdownGenerator.generate(data, schema);
          const mdPath = document.fileName.replace(/\.spec\.yaml$/, '.spec.md');
          fs.writeFileSync(mdPath, mdContent, 'utf8');
          log(`Markdown生成完了: ${mdPath}`);
        } catch (err: any) {
          log(`Markdown生成失敗: ${err.message}`);
          vscode.window.showErrorMessage(`Markdown生成エラー: ${err.message}`);
        }
      }
    })
  );
}

export function deactivate() {}