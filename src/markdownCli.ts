import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { MarkdownGenerator } from './markdownGenerator';
import { SpecData, TableSchema } from './types';

function findFiles(rootDir: string, predicate: (filePath: string) => boolean): string[] {
  const files: string[] = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vscode-test') {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (predicate(filePath)) {
        files.push(filePath);
      }
    }
  }

  visit(rootDir);
  return files;
}

function loadSchemas(rootDir: string): Map<string, TableSchema> {
  const schemas = new Map<string, TableSchema>();
  const schemaFiles = findFiles(rootDir, filePath => filePath.endsWith('.schema.yaml'));

  for (const schemaFile of schemaFiles) {
    const schema = yaml.load(fs.readFileSync(schemaFile, 'utf8')) as TableSchema;
    if (!schema?.schema_id) {
      throw new Error(`schema_id がありません: ${path.relative(rootDir, schemaFile)}`);
    }
    if (schemas.has(schema.schema_id)) {
      throw new Error(`schema_id が重複しています: ${schema.schema_id}`);
    }
    schemas.set(schema.schema_id, schema);
  }

  return schemas;
}

function parseSpec(specFile: string): SpecData {
  const data = yaml.load(fs.readFileSync(specFile, 'utf8')) as SpecData;
  if (!data || typeof data !== 'object') {
    throw new Error(`YAML データが空または不正です: ${specFile}`);
  }
  if (!data.schema) {
    throw new Error(`schema がありません: ${specFile}`);
  }
  if (!Array.isArray(data.items)) {
    throw new Error(`items が配列ではありません: ${specFile}`);
  }
  return data;
}

function checkSpec(rootDir: string, specFile: string, schemas: Map<string, TableSchema>, write: boolean): boolean {
  const relativeSpecPath = path.relative(rootDir, specFile);
  const data = parseSpec(specFile);
  const schema = schemas.get(data.schema);
  if (!schema) {
    throw new Error(`対応する schema がありません: ${relativeSpecPath} (${data.schema})`);
  }

  const expected = MarkdownGenerator.generate(data, schema);
  const markdownFile = specFile.replace(/\.spec\.ya?ml$/, '.spec.md');
  if (write) {
    fs.writeFileSync(markdownFile, expected, 'utf8');
    console.log(`生成: ${path.relative(rootDir, markdownFile)}`);
    return true;
  }
  if (!fs.existsSync(markdownFile)) {
    console.error(`NG: Markdown がありません: ${path.relative(rootDir, markdownFile)}`);
    return false;
  }

  const actual = fs.readFileSync(markdownFile, 'utf8');
  if (actual !== expected) {
    console.error(`NG: YAML と Markdown が一致しません: ${relativeSpecPath}`);
    console.error(`    期待されるファイル: ${path.relative(rootDir, markdownFile)}`);
    return false;
  }

  console.log(`OK: ${relativeSpecPath}`);
  return true;
}

function main(): number {
  const write = process.argv.includes('--write');
  const rootArgument = process.argv.slice(2).find(argument => argument !== '--write');
  const rootDir = path.resolve(rootArgument || process.cwd());
  const schemas = loadSchemas(rootDir);
  const specFiles = findFiles(rootDir, filePath => /\.spec\.ya?ml$/.test(filePath));

  if (specFiles.length === 0) {
    console.error(`spec YAML が見つかりません: ${rootDir}`);
    return 1;
  }

  let valid = true;
  for (const specFile of specFiles.sort()) {
    try {
      if (!checkSpec(rootDir, specFile, schemas, write)) {
        valid = false;
      }
    } catch (error) {
      console.error(`NG: ${error instanceof Error ? error.message : String(error)}`);
      valid = false;
    }
  }

  return valid ? 0 : 1;
}

process.exitCode = main();
