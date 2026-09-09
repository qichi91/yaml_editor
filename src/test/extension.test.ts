import * as assert from 'assert';

import * as vscode from 'vscode';
import { sanitizeForSave } from '../dataUtils';

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
});
