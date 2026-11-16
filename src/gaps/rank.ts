import type { Gap } from './analyze.js';
const priority = { file: 3, function: 2, branch: 1 };
export function rank(gaps: Gap[]): Gap[] {
  return gaps.map((gap) => ({ ...gap, score: gap.lines * 10 + priority[gap.kind] }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.loc.start.line - b.loc.start.line || a.loc.start.column - b.loc.start.column);
}
