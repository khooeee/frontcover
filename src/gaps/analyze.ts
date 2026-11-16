import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rank } from './rank.js';
import { isTypeOnly } from './type-only.js';

export interface Position { line: number; column: number }
export interface Location { start: Position; end: Position }
export interface Gap {
  id: string;
  kind: 'file' | 'function' | 'branch';
  file: string;
  name?: string;
  inside?: string;
  loc: Location;
  lines: number;
  snippet: string;
  score: number;
}
export interface FileCoverage {
  path: string;
  statementMap: Record<string, Location>;
  s: Record<string, number>;
  fnMap: Record<string, { name: string; decl: Location; loc: Location }>;
  f: Record<string, number>;
  branchMap: Record<string, { type: string; loc: Location; locations: Location[] }>;
  b: Record<string, number[]>;
}
export type CoverageMap = Record<string, FileCoverage>;

function compare(a: Position, b: Position): number { return a.line - b.line || a.column - b.column; }
function valid(loc: Location | undefined): loc is Location {
  return !!loc && Number.isInteger(loc.start?.line) && Number.isInteger(loc.end?.line)
    && Number.isInteger(loc.start.column) && Number.isInteger(loc.end.column)
    && loc.start.line > 0 && compare(loc.start, loc.end) < 0;
}
function contains(outer: Location, inner: Location): boolean {
  return compare(outer.start, inner.start) <= 0 && compare(outer.end, inner.end) >= 0;
}
function span(loc: Location): number { return loc.end.line - loc.start.line + (loc.end.column === 0 ? 0 : 1); }

/** Prefer original declarations even when the bundle's function names were minified. */
export function functionName(name: string, decl: Location, source: string): string {
  const lines = source.split('\n');
  const line = lines[decl.start.line - 1] ?? '';
  const signature = line.slice(decl.start.column);
  const declared = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([\w$]+)/.exec(signature)
    ?? /\bfunction\s*\*?\s*([\w$]+)/.exec(line.slice(0, decl.end.column));
  if (declared?.[1]) return declared[1];
  const prefix = lines.slice(Math.max(0, decl.start.line - 3), decl.start.line - 1).join('\n') + '\n' + line.slice(0, decl.start.column);
  const inferred = /(?:const|let|var)\s+([\w$]+)(?:\s*:[^=]+)?\s*=\s*(?:[\w$.]+(?:\(\s*)?)?(?:async\s*)?$/.exec(prefix)
    ?? /([\w$]+)\s*=\s*\{\s*$/.exec(prefix)
    ?? /([\w$]+)\s*:\s*(?:async\s*)?$/.exec(prefix);
  if (inferred?.[1]) return inferred[1];
  return !name || /^\(?anonymous/.test(name) ? 'anonymous' : name;
}

export function analyzeFile(file: string, coverage: FileCoverage, source: string): Gap[] {
  const text = source.split('\n');
  const ordinals = new Map<string, number>();
  const make = (kind: Gap['kind'], loc: Location, name?: string, inside?: string): Gap => {
    const firstLine = (text[loc.start.line - 1] ?? '').trim();
    const key = `${file}\0${kind}\0${firstLine}`;
    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);
    return {
      id: createHash('sha256').update(`${key}\0${ordinal}`).digest('hex').slice(0, 12),
      kind, file, name, inside, loc, lines: Math.max(1, span(loc)), score: 0,
      snippet: text.slice(loc.start.line - 1, Math.min(loc.end.line, loc.start.line + 7))
        .map((line, i) => `${loc.start.line + i} | ${line}`).join('\n'),
    };
  };
  const functions = Object.entries(coverage.fnMap).filter(([, fn]) => valid(fn.loc)).map(([id, fn]) => ({
    id, name: functionName(fn.name, fn.decl, source),
    loc: { start: valid(fn.decl) && compare(fn.decl.start, fn.loc.start) <= 0 ? fn.decl.start : fn.loc.start, end: fn.loc.end },
  })).sort((a, b) => compare(a.loc.start, b.loc.start) || compare(b.loc.end, a.loc.end));
  const candidates: Gap[] = [];
  for (const fn of functions) {
    const gap = make('function', fn.loc, fn.name);
    if (coverage.f[fn.id] === 0) candidates.push(gap);
  }
  const branches = Object.entries(coverage.branchMap).flatMap(([id, branch]) => branch.locations.map((loc, arm) => ({ id, branch, loc, arm })))
    .filter((item) => valid(item.loc))
    .sort((a, b) => compare(a.loc.start, b.loc.start) || compare(b.loc.end, a.loc.end));
  for (const { id, branch, loc, arm } of branches) {
    // Select the innermost enclosing function, including an uncalled callback.
    const fn = functions.filter((fn) => contains(fn.loc, loc)).sort((a, b) => span(a.loc) - span(b.loc) || compare(b.loc.start, a.loc.start))[0];
    const gap = make('branch', loc, branch.type, fn?.name);
    if (fn && (coverage.f[fn.id] ?? 0) > 0 && coverage.b[id]?.[arm] === 0) candidates.push(gap);
  }
  // Outermost uncovered paths explain any nested uncalled callbacks/branches.
  candidates.sort((a, b) => compare(a.loc.start, b.loc.start) || compare(b.loc.end, a.loc.end)
    || Number(b.kind === 'function') - Number(a.kind === 'function'));
  return candidates.filter((gap, index) => !candidates.slice(0, index).some((outer) => contains(outer.loc, gap.loc)));
}

export async function analyze(coverage: CoverageMap, files: string[], rootDir: string): Promise<Gap[]> {
  const gaps: Gap[] = [];
  for (const file of files) {
    const source = await fs.readFile(path.resolve(rootDir, file), 'utf8');
    if (isTypeOnly(source)) continue;
    const data = coverage[file];
    if (data) {
      gaps.push(...analyzeFile(file, data, source));
    } else {
      const text = source.trimEnd().split('\n');
      const loc = { start: { line: 1, column: 0 }, end: { line: text.length, column: text.at(-1)?.length ?? 0 } };
      gaps.push({
        id: createHash('sha256').update(`${file}\0file\0${(text[0] ?? '').trim()}\0${0}`).digest('hex').slice(0, 12),
        kind: 'file', file, loc, lines: text.length, score: 0,
        snippet: text.slice(0, 8).map((line, i) => `${i + 1} | ${line}`).join('\n'),
      });
    }
  }
  return rank(gaps);
}
