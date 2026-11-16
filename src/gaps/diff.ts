import type { Gap } from './analyze.js';
export function diff(previous: Gap[], current: Gap[]) {
  const before = new Set(previous.map((gap) => gap.id));
  const after = new Set(current.map((gap) => gap.id));
  return {
    closed: previous.filter((gap) => !after.has(gap.id)),
    new: current.filter((gap) => !before.has(gap.id)),
    remaining: current.filter((gap) => before.has(gap.id)),
  };
}
