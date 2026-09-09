# Table Spec Editor

`*.spec.yaml` / `*.spec.yml` を表形式で編集する VS Code 拡張機能です。列定義や入力チェックをプロジェクト内の `*.schema.yaml` に分離し、同じエディタで画面仕様書、API パラメータ定義書など複数の形式を扱えます。

YAML をデータの正本とし、保存時にスキーマのテンプレートから納品用 Markdown を生成します。YAML は Git で差分管理しやすい形式のまま保持できます。

## 主な機能

- `*.spec.yaml` / `*.spec.yml` を開くと、既定でテーブルエディタを表示
- スキーマに応じたヘッダー、列、列幅、入力形式の動的な構成
- `string`、`multiline`、`select` の入力形式
- 必須チェック、選択肢チェック、正規表現による入力チェック
- テーブル末尾の入力用空行と、入力時の行追加
- 未定義の既存キーを保持したまま YAML を再保存
- Excel との矩形コピー・貼り付け
- `Ctrl+Z` / `Ctrl+Y` による未保存編集の Undo / Redo
- セル編集・コピペ・範囲クリアの履歴を一括で保持
- 保存時のみ YAML を反映し、変更内容は編集中に保持
- `Ctrl+S` で `*.spec.md` を自動生成

## 基本的な使い方

### 1. スキーマを配置する

ワークスペース内の任意の場所に `*.schema.yaml` を配置します。拡張機能は `node_modules` を除くワークスペース全体からスキーマを検索します。

スキーマを追加・変更すると、ファイル変更を検知して再読み込みします。スキーマファイル名の拡張子は `.schema.yaml` にしてください。`.schema.yml` は検索対象外です。

### 2. spec YAML を作成する

YAML の `schema` に、利用するスキーマの `schema_id` を指定します。

```yaml
schema: screen-item
screen_id: SCR-001
screen_name: ユーザー登録
items:
	- id: "001"
		label: ユーザー名
		type: テキストボックス
		required: "○"
		description: ログインに使用する名前
```

この例では、`schemas/screen-item.schema.yaml` の `schema_id: screen-item` が選択されます。`schema` が未指定、または一致するスキーマが存在しない場合は、汎用のフォールバック列が表示されます。

### 3. テーブルで編集する

spec YAML を VS Code で開くと、ヘッダー入力欄とテーブルが表示されます。セルを編集すると、変更内容は YAML ドキュメントに反映されます。

テーブルには入力用の空行が末尾に表示されます。空行に入力すると正式な行になり、次の入力用空行が追加されます。全セルが空の行は保存データとして扱われません。

スキーマ変更後も、画面に表示されない既存キーは YAML から削除されません。列定義から外れたデータを保持したまま、別のスキーマへ切り替えることもできます。

### 編集履歴と保存

編集結果は即座にファイルへ書き戻すのではなく、エディタ内で履歴として保持されます。そのため、セル編集やコピペ、範囲クリアの操作は `Ctrl+Z` / `Ctrl+Y` で巻き戻し・やり直しできます。

- 1セルの編集ごとに 1 ステップの Undo を積む
- コピペや範囲クリアも 1 操作として履歴に残る
- 変更内容は保存時に YAML として反映される
- Markdown 生成は保存時のみ発生する

保存前の状態は YAML ファイル本体には反映されないため、誤った編集を試しても `Ctrl+S` を実行するまで破壊的に上書きされません。

## スキーマ定義

### スキーマ全体

```yaml
schema_id: example
schema_version: "1.0"
title: サンプル仕様書

headers:
	- key: screen_id
		label: 画面ID
		required: true

columns:
	- key: id
		label: 項目ID
		width: 100
		type: string
		required: true
		pattern: "^[0-9]{3}$"
		pattern_error: "3桁の半角数字を入力してください"

markdown_template: |
	# {{title}}

	| {{header_row}} |
	| {{separator_row}} |
	{{#items}}
	| {{id}} |
	{{/items}}
```

| フィールド | 必須 | 説明 |
| :--- | :---: | :--- |
| `schema_id` | ○ | spec YAML の `schema` と一致させる一意な識別子 |
| `schema_version` | ○ | スキーマのバージョン文字列 |
| `title` | ○ | Markdown 出力などで使用する仕様書名 |
| `headers` | - | テーブル外に表示する共通入力欄 |
| `columns` | ○ | メインテーブルの列定義 |
| `subtables` | - | メインテーブル以外のテーブル定義 |
| `markdown_template` | ○ | Markdown 出力テンプレート |

### `headers`

ヘッダー入力欄を定義します。`key` は spec YAML のトップレベルキー、`label` は画面表示名です。

```yaml
headers:
	- key: document_id
		label: ドキュメントID
		required: true
	- key: owner
		label: 担当者
```

### `columns`

各列では次の項目を指定できます。

| フィールド | 説明 |
| :--- | :--- |
| `key` | 行データ内のキー |
| `label` | テーブルヘッダーに表示する名前 |
| `width` | 初期列幅（px） |
| `type` | `string`、`multiline`、`select` のいずれか |
| `options` | `select` で表示する選択肢の配列 |
| `options_strict` | `true` の場合、選択肢にない値をエラーにする |
| `required` | `true` の場合、空値をエラーにする |
| `pattern` | JavaScript の正規表現として評価する文字列 |
| `pattern_error` | `pattern` 不一致時のエラーメッセージ |
| `align` | Markdown の区切り行の配置。`left`、`center`、`right` |

`pattern` は `string` 専用ではなく、値が空でないすべての列に適用されます。`select` では `options_strict` のチェック後に適用されます。値全体を検証する場合は `^` と `$` を付けてください。

```yaml
columns:
	- key: status
		label: ステータス
		type: select
		options: [未着手, 対応中, 完了]
		options_strict: true
		required: true
		align: center

	- key: item_id
		label: 項目ID
		type: string
		pattern: "^[A-Z]{2}-[0-9]{3}$"
		pattern_error: "AA-001 の形式で入力してください"
		align: left

	- key: description
		label: 説明
		type: multiline
```

完全なサンプルは `schemas/sample-all.schema.yaml` を参照してください。既存のサンプルとして `schemas/api-param.schema.yaml` と `schemas/screen-item.schema.yaml` も含まれています。

### `subtables`

サブテーブルを定義すると、メインテーブルとは別の配列を編集できます。`data_key` が spec YAML のトップレベル配列名になります。

```yaml
subtables:
	- data_key: choices
		title: 選択肢一覧
		columns:
			- key: value
				label: 値
				type: string
			- key: label
				label: 表示名
				type: string
```

対応するデータは次のように記述します。

```yaml
schema: example
items: []
choices:
	- value: A
		label: 選択肢A
```

## Markdown の生成

Markdown は、spec YAML を保存したときだけ生成されます。`Ctrl+S` または「ファイル」から保存すると、次の処理が行われます。

1. spec YAML を読み込む
2. `schema` に対応するスキーマを検索する
3. `markdown_template` のプレースホルダーをデータで置換する
4. spec YAML と同じ場所に `*.spec.md` を書き出す

Markdown は編集用データではなく生成物です。内容を変更する場合は Markdown ではなく spec YAML またはスキーマを編集し、もう一度 spec YAML を保存してください。

### CI での整合性チェック

リポジトリ上のすべての spec YAML を対象に Markdown を再生成し、コミット済みの `*.spec.md` と完全一致することを検証できます。検証では Markdown ファイルを書き換えません。一致しない場合や Markdown が存在しない場合は終了コード `1` で終了するため、CI のマージチェックに利用できます。

```bash
npm run check:markdown
```

Markdown を意図的に更新する場合は、YAML またはスキーマを変更した後に次のコマンドを実行し、生成された Markdown の差分をコミットします。

```bash
npm run generate:markdown
```

`check:markdown` は内部で TypeScript をコンパイルした後、ワークスペース配下の `*.spec.yaml` / `*.spec.yml` を走査します。`node_modules`、`.git`、`.vscode-test` は走査対象外です。

### テンプレート記法

| 記法 | 内容 |
| :--- | :--- |
| `{{title}}` | スキーマの `title` |
| `{{key}}` | spec YAML のトップレベル値 |
| `{{header_row}}` | `columns` のラベルを結合したヘッダー行 |
| `{{separator_row}}` | `align` に応じた Markdown 区切り行 |
| `{{#items}} ... {{/items}}` | メインテーブルの行繰り返し |
| `{{#data_key}} ... {{/data_key}}` | サブテーブルの行繰り返し |
| `{{row_number}}` | 行ブロック内の1始まりの行番号 |
| `{{data_key_title}}` | サブテーブルの `title` |

セル内の改行は `<br>` に、Markdown の `|` は `\|` に変換されます。

行番号列を出力する場合は、テンプレートのヘッダーと区切り行に列を追加し、行ブロック内に `{{row_number}}` を記述します。

```yaml
markdown_template: |
	| No. | {{header_row}} |
	| :---: | {{separator_row}} |
	{{#items}}
	| {{row_number}} | {{id}} | {{label}} |
	{{/items}}
```

`{{row_number}}` は実データのキーではなく、各行ブロックの展開時に `1` から連番で置換されます。`items` だけでなく、サブテーブルの行ブロックでも利用できます。

## インストールと開発

### 依存関係のインストール

```bash
npm install
```

### コンパイル

```bash
npm run compile
```

### Lint とテスト

```bash
npm run lint
npm test
```

### VSIX の作成

```bash
npx vsce package --allow-missing-repository --skip-license
```

生成された `.vsix` は、VS Code の「拡張機能: VSIX からのインストール」からインストールできます。

## ファイル構成

```text
schemas/                  # プロジェクト固有のスキーマ
	*.schema.yaml
src/                      # 拡張機能本体
media/editor.html         # テーブル UI
*.spec.yaml               # 編集対象となるデータ YAML
*.spec.md                 # 保存時に生成される Markdown
```

## 注意事項

- スキーマ検索対象は `*.schema.yaml` です。スキーマを追加した場合は、ファイルがワークスペース配下にあることを確認してください。
- `schema` の値と `schema_id` が一致しない場合、指定したスキーマの列定義は使用されません。
- Markdown は保存時に上書き生成されます。生成物を直接編集すると、次回保存時に内容が置き換わります。
