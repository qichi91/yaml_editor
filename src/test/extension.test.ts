import * as assert from 'assert';

import * as vscode from 'vscode';
import { sanitizeForSave } from '../dataUtils';
import { MarkdownGenerator } from '../markdownGenerator';
import { TableSchema } from '../types';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('sanitizeForSave strips blank rows before save', () => {
		const result = sanitizeForSave({
			schema: 'sample',
			items: [
				{ name: 'A', value: '1' },
				{ name: '', value: '' },
				{ name: ' ', value: '  ' }
			],
			children: [
				{ name: 'ok' },
				{ name: '', value: '' }
			]
		});

		assert.deepStrictEqual(result.items, [{ name: 'A', value: '1' }]);
		assert.deepStrictEqual(result.children, [{ name: 'ok' }]);
	});

	test('MarkdownGenerator adds independent scenario headings to configured flows', () => {
		const schema: TableSchema = {
			schema_id: 'usecase',
			schema_version: '1.0',
			title: 'ユースケース',
			headers: [{ key: 'summary', label: '概要', type: 'multiline' }],
			columns: [{ key: 'steps', label: '手順' }],
			scenario_heading: { label: 'シナリオ', markdown_level: 3 },
			subtables: [{
				data_key: 'alternate_flows',
				title: '代替フロー',
				columns: [{ key: 'steps', label: '手順' }],
				scenario_heading: { label: 'シナリオ', markdown_level: 3 }
			}],
			markdown_template: [
				'| {{summary}} |',
				'{{#items}}',
				'{{steps}}',
				'{{/items}}',
				'{{#alternate_flows}}',
				'{{steps}}',
				'{{/alternate_flows}}'
			].join('\n')
		};

		const markdown = MarkdownGenerator.generate({
			schema: 'usecase',
			summary: '概要1行目\n概要2行目 | 補足',
			items: [
				{ steps: '開始' },
				{ steps: '分岐', _indent: 0 },
				{ steps: '成功時', _indent: 1 },
				{ steps: '終了', _indent: 0 }
			],
			alternate_flows: [
				{ steps: '入力エラー', _indent: 0 },
				{ steps: '再入力', _indent: 1 }
			]
		}, schema);

		assert.match(markdown, /### シナリオ1\n\n開始/);
		assert.match(markdown, /\| 概要1行目<br>概要2行目 \\| 補足 \|/);
		assert.match(markdown, /### シナリオ2\n\n分岐/);
		assert.match(markdown, /#### シナリオ2-1\n\n成功時/);
		assert.match(markdown, /### シナリオ3\n\n終了/);
		assert.match(markdown, /### シナリオ1\n\n入力エラー/);
		assert.match(markdown, /#### シナリオ1-1\n\n再入力/);
	});

	test('MarkdownGenerator preserves row templates without scenario heading config', () => {
		const schema: TableSchema = {
			schema_id: 'legacy',
			schema_version: '1.0',
			title: '従来形式',
			columns: [{ key: 'name', label: '名称' }],
			markdown_template: '{{#items}}| {{row_number}} | {{name}} |{{/items}}'
		};
		const markdown = MarkdownGenerator.generate({
			schema: 'legacy',
			items: [{ name: '項目' }]
		}, schema);

		assert.strictEqual(markdown, '| 1 | 項目 |');
	});

	test('MarkdownGenerator renders multiple actors, conditions, and triggers', () => {
		const schema: TableSchema = {
			schema_id: 'usecase',
			schema_version: '1.0',
			title: 'ユースケース',
			columns: [],
			subtables: [
				{
					data_key: 'actors',
					title: 'アクター',
					columns: [{ key: 'name', label: 'アクター' }, { key: 'description', label: '役割' }]
				},
				{
					data_key: 'conditions',
					title: '条件',
					columns: [{ key: 'type', label: '種別' }, { key: 'description', label: '条件' }]
				},
				{
					data_key: 'triggers',
					title: 'トリガー',
					columns: [{ key: 'description', label: 'トリガー' }]
				}
			],
			markdown_template: [
				'{{#actors}}| {{name}} | {{description}} |',
				'{{/actors}}',
				'{{#conditions}}| {{type}} | {{description}} |',
				'{{/conditions}}',
				'{{#triggers}}| {{description}} |',
				'{{/triggers}}',
				'{{#actors}}actor "{{name}}" as Actor_{{row_number}}',
				'{{/actors}}',
				'{{#actors}}Actor_{{row_number}} --> CurrentUC',
				'{{/actors}}'
			].join('\n')
		};
		const markdown = MarkdownGenerator.generate({
			schema: 'usecase',
			items: [],
			actors: [
				{ name: '利用者', description: '登録する' },
				{ name: '運用担当者', description: '状況を確認する' }
			],
			conditions: [
				{ type: '事前条件', description: '画面を表示している' },
				{ type: '事後条件', description: '登録が完了している' }
			],
			triggers: [
				{ description: '新規登録を選択する' },
				{ description: '登録リンクを開く' }
			]
		}, schema);

		assert.match(markdown, /\| 利用者 \| 登録する \|/);
		assert.match(markdown, /\| 運用担当者 \| 状況を確認する \|/);
		assert.match(markdown, /\| 事前条件 \| 画面を表示している \|/);
		assert.match(markdown, /\| 事後条件 \| 登録が完了している \|/);
		assert.match(markdown, /\| 新規登録を選択する \|/);
		assert.match(markdown, /\| 登録リンクを開く \|/);
		assert.match(markdown, /actor "利用者" as Actor_1/);
		assert.match(markdown, /actor "運用担当者" as Actor_2/);
		assert.match(markdown, /Actor_1 --> CurrentUC/);
		assert.match(markdown, /Actor_2 --> CurrentUC/);
	});

	test('MarkdownGenerator resolves basic-info rows in document headings and diagrams', () => {
		const schema: TableSchema = {
			schema_id: 'usecase',
			schema_version: '1.0',
			title: 'ユースケース',
			columns: [],
			subtables: [{
				data_key: 'basic_info',
				title: '基本情報',
				columns: [{ key: 'label', label: '項目' }, { key: 'value', label: '内容', type: 'multiline' }]
			}],
			markdown_template: [
				'# {{basic_info:ユースケース名}}',
				'{{#basic_info}}',
				'| {{label}} | {{value}} |',
				'{{/basic_info}}',
				'package "{{basic_info:パッケージ}}" {',
				'usecase "{{basic_info:ユースケース名}}" as CurrentUC'
			].join('\n')
		};
		const markdown = MarkdownGenerator.generate({
			schema: 'usecase',
			items: [],
			basic_info: [
				{ label: 'ユースケース名', value: 'ユーザー登録' },
				{ label: '概要', value: '1行目\n2行目 | 補足' },
				{ label: 'パッケージ', value: 'アカウント管理' }
			]
		}, schema);

		assert.match(markdown, /# ユーザー登録/);
		assert.match(markdown, /\| 概要 \| 1行目<br>2行目 \\| 補足 \|/);
		assert.match(markdown, /package "アカウント管理" \{/);
		assert.match(markdown, /usecase "ユーザー登録" as CurrentUC/);
	});
});
