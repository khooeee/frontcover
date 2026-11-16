import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyze, analyzeFile, functionName, type FileCoverage, type Location } from '../src/gaps/analyze.js';
import { rank } from '../src/gaps/rank.js';
import { diff } from '../src/gaps/diff.js';
import { isTypeOnly } from '../src/gaps/type-only.js';

const loc = (line: number, endLine = line, column = 0, endColumn = 20): Location => ({ start: { line, column }, end: { line: endLine, column: endColumn } });
const empty = (): FileCoverage => ({ path: 'src/app.ts', statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} });

it('finds a branch only inside the innermost called function; ignores implicit else ranges', () => {
  const c = empty();
  c.fnMap = { outer: { name: 'outer', decl: loc(1), loc: loc(1, 12) }, inner: { name: 'inner', decl: loc(3), loc: loc(3, 5) } };
  c.f = { outer: 1, inner: 0 };
  c.branchMap = { active: { type: 'if', loc: loc(7, 9), locations: [loc(8), { start: {}, end: {} } as Location] }, uncalled: { type: 'if', loc: loc(4), locations: [loc(4)] } };
  c.b = { active: [0, 0], uncalled: [0] };
  const gaps = analyzeFile('src/app.ts', c, 'function outer() {\n\nfunction inner() {\n  if (x) work();\n}\n\nif (y) {\n  missed();\n}\n\n\n}');
  expect(gaps.map((g) => [g.kind, g.name, g.inside])).toEqual([['function', 'inner', undefined], ['branch', 'if', 'outer']]);
});

it('folds nested functions and branches into the outermost gap', () => {
  const c = empty();
  c.fnMap = { outer: { name: 'outer', decl: loc(1), loc: loc(1, 10) }, inner: { name: 'inner', decl: loc(3), loc: loc(3, 5) } };
  c.f = { outer: 0, inner: 0 };
  expect(analyzeFile('src/app.ts', c, 'function outer() {\n\n function inner() {}').map((g) => g.name)).toEqual(['outer']);
  c.f.outer = 1;
  c.branchMap = { b: { type: 'if', loc: loc(2, 7), locations: [loc(2, 7)] } };
  c.b = { b: [0] };
  expect(analyzeFile('src/app.ts', c, 'function outer() {\nif (missing) {\n function inner() {}').map((g) => g.kind)).toEqual(['branch']);
});

it('uses source text for stable IDs despite line shifts and coverage changes to duplicate paths', () => {
  const c = empty();
  c.fnMap = { a: { name: 'minified', decl: loc(1), loc: loc(1, 2) }, b: { name: 'minified', decl: loc(4), loc: loc(4, 5) } };
  c.f = { a: 0, b: 0 };
  const source = 'const handler = () => {\n work();\n}\nconst handler = () => {\n work();\n}';
  const before = analyzeFile('src/app.ts', c, source);
  c.f.a = 1;
  const after = analyzeFile('src/app.ts', c, source);
  expect(after[0]!.id).toBe(before[1]!.id);
  const shifted = structuredClone(c);
  for (const fn of Object.values(shifted.fnMap)) for (const range of [fn.decl, fn.loc]) { range.start.line++; range.end.line++; }
  expect(analyzeFile('src/app.ts', shifted, '\n' + source)[0]!.id).toBe(after[0]!.id);
});

it('recovers original and anonymous names', () => {
  expect(functionName('m', loc(1), 'function deleteTodo(id: string) {')).toBe('deleteTodo');
  expect(functionName('(anonymous_0)', loc(1, 1, 13), 'const save = () => {}')).toBe('save');
  expect(functionName('(anonymous_1)', loc(1, 1, 17), '<button onClick={() => save()} />')).toBe('onClick');
  expect(functionName('(anonymous_2)', loc(1, 1, 8), '{ save: () => {} }')).toBe('save');
});

it('keeps the first identity when source maps collapse two function ranges to the same location', () => {
  const c = empty();
  const source = 'const Settings = lazy(() => import("./Settings"));';
  const fn = { name: 'lazy', decl: loc(1, 1, 21, 28), loc: loc(1, 1, 28, 48) };
  c.fnMap = { first: fn }; c.f = { first: 0 };
  const original = analyzeFile('src/app.ts', c, source)[0]!;
  c.fnMap.second = structuredClone(fn); c.f.second = 0;
  const folded = analyzeFile('src/app.ts', c, source);
  expect(folded).toHaveLength(1);
  expect(folded[0]!.id).toBe(original.id);
  expect(folded[0]!.name).toBe('Settings');
});

it('finds never-loaded files, skips type declarations, and keeps a loaded file with no hits as function gaps', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frontcover-analyze-'));
  try {
    await fs.writeFile(path.join(root, 'settings.ts'), 'export function Settings() {}\n');
    await fs.writeFile(path.join(root, 'types.ts'), 'export interface Props { name: string }');
    await fs.writeFile(path.join(root, 'loaded.ts'), 'function handler() {}');
    const c = empty(); c.fnMap = { a: { name: 'handler', decl: loc(1), loc: loc(1) } }; c.f = { a: 0 };
    const gaps = await analyze({ 'loaded.ts': c }, ['settings.ts', 'types.ts', 'loaded.ts'], root);
    expect(gaps.map((g) => [g.file, g.kind])).toEqual([['settings.ts', 'file'], ['loaded.ts', 'function']]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('ranks by line span, then file > function > branch, and diffs by ID', () => {
  const c = empty(); c.fnMap = { a: { name: 'fn', decl: loc(1), loc: loc(1) } }; c.f = { a: 0 };
  const template = analyzeFile('src/app.ts', c, 'function fn() {}')[0]!;
  const gaps = rank(['branch', 'function', 'file'].map((kind, i) => ({ ...template, id: String(i), kind: kind as typeof template.kind })));
  expect(gaps.map((g) => g.kind)).toEqual(['file', 'function', 'branch']);
  const delta = diff(gaps.slice(0, 2), gaps.slice(1));
  expect(delta.closed.map((g) => g.kind)).toEqual(['file']);
  expect(delta.new.map((g) => g.kind)).toEqual(['branch']);
  expect(delta.remaining.map((g) => g.kind)).toEqual(['function']);
});

describe('type-only heuristic', () => {
  it.each([
    '', '// nothing\n', 'export interface X { a: { b: string }; call(): void }',
    'import type { Todo } from "./types";\nexport type List = Todo[];',
    'export type A = { x: number; y: { z: string } }; export interface B {}',
    'type Fn<T> = (value: T) => void;',
    'type A = string\nexport type B = A | null\ninterface C {}',
  ])('accepts %s', (source) => { expect(isTypeOnly(source)).toBe(true); });
  it.each([
    'export const x = 1;', 'export enum X { A }', 'import "./side-effect";',
    'interface Props {}\nexport function Component() { return null; }',
    'type A = string\nconst runtime = 1', 'type A = string\nconsole.log("runtime")',
    'type A = { x: string };\nthrow new Error("runtime")',
  ])('rejects %s', (source) => { expect(isTypeOnly(source)).toBe(false); });
});
