import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { TableSchema } from './types';

export class SchemaManager {
  private schemas: Map<string, TableSchema> = new Map();
  private schemaSources: Map<string, string> = new Map();

  public constructor(private readonly output?: vscode.OutputChannel) {}

  private log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    this.output?.appendLine(line);
    console.log(`[Table Spec Editor] ${message}`);
  }

  // ワークスペース内の全スキーマファイルを読み込み
  public async loadAllSchemas(): Promise<void> {
    this.schemas.clear();
    this.schemaSources.clear();
    this.log('スキーマ読み込み開始');
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    this.log(`ワークスペース: ${workspaceFolders.length}件`);
    workspaceFolders.forEach(folder => this.log(`  ${folder.uri.fsPath}`));

    const includePattern = '**/*.schema.yaml';
    const excludePattern = '**/node_modules/**';
    this.log(`スキーマ検索: include=${includePattern}, exclude=${excludePattern}`);
    const files = await vscode.workspace.findFiles(includePattern, excludePattern);
    this.log(`スキーマ候補: ${files.length}件`);

    for (const uri of files) {
      this.log(`スキーマ候補ファイル: ${uri.fsPath}`);
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const schema = yaml.load(content) as TableSchema;
        if (schema && schema.schema_id) {
          this.schemas.set(schema.schema_id, schema);
          this.schemaSources.set(schema.schema_id, uri.fsPath);
          this.log(`スキーマ登録: ${schema.schema_id} (${uri.fsPath})`);
        } else {
          this.log(`スキーマ無効: schema_idがありません (${uri.fsPath})`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`スキーマ読み込み失敗: ${uri.fsPath} - ${message}`);
      }
    }

    this.log(`スキーマ読み込み完了: ${this.schemas.size}件 [${this.getAllSchemaIds().join(', ')}]`);
  }

  public getSchema(schemaId: string): TableSchema | undefined {
    const schema = this.schemas.get(schemaId);
    this.log(`getSchema: 要求=${schemaId || '(空)'}, 結果=${schema?.schema_id || 'undefined'}`
      + (schema ? `, source=${this.schemaSources.get(schemaId) || '(不明)'}` : ''));
    return schema;
  }

  public getAllSchemaIds(): string[] {
    return Array.from(this.schemas.keys());
  }

  public getFallbackSchema(): TableSchema {
    return {
      schema_id: 'default',
      schema_version: '1.0',
      title: '汎用テーブル',
      columns: [
        { key: 'id', label: 'ID', width: 100, type: 'string' },
        { key: 'name', label: '名称', width: 150, type: 'string' },
        { key: 'description', label: '説明', type: 'multiline' }
      ],
      markdown_template: "# {{title}}\n\n| {{header_row}} |\n| {{separator_row}} |\n{{#items}}\n| {{id}} | {{name}} | {{description}} |\n{{/items}}"
    };
  }
}