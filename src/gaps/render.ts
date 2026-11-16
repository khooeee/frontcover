import type { Gap } from './analyze.js';
function label(gap: Gap) { return `${gap.name ?? 'never loaded'}${gap.inside ? ` in ${gap.inside}` : ''}`; }
export function terminal(gaps: Gap[]): string {
  if (!gaps.length) return 'No gaps found.';
  return ['ID            KIND      LINES  LOCATION / PATH', ...gaps.map((gap) =>
    `${gap.id.padEnd(12)}  ${gap.kind.padEnd(8)}  ${String(gap.lines).padStart(5)}  ${gap.file}:${gap.loc.start.line}  ${label(gap)}`)].join('\n');
}
export function detail(gap: Gap): string {
  return `${gap.id}  ${gap.kind}: ${label(gap)}\n${gap.file}:${gap.loc.start.line} (${gap.lines} lines)\n\n${gap.snippet}`;
}
export function markdown(gaps: Gap[]): string {
  if (!gaps.length) return '# frontcover gaps\n\nNo gaps found.\n';
  const escape = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return '# frontcover gaps\n\n| ID | Kind | Lines | Location | Path |\n| --- | --- | ---: | --- | --- |\n' + gaps.map((gap) =>
    `| ${gap.id} | ${gap.kind} | ${gap.lines} | ${escape(gap.file)}:${gap.loc.start.line} | ${escape(label(gap))} |`).join('\n') + '\n';
}
export function json(gaps: Gap[]): string { return JSON.stringify(gaps, null, 2); }
