/** Conservative declaration scanner: unknown syntax counts as executable code. */
export function isTypeOnly(source: string): boolean {
  const tokens = [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|=>|[\w$]+|[^\s]/g)]
    .filter((token) => !token[0].startsWith('//') && !token[0].startsWith('/*'));
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i]?.[0] === ';') { i++; continue; }
    if (tokens[i]?.[0] === 'export') i++;
    if (tokens[i]?.[0] === 'declare') i++;
    const kind = tokens[i++]?.[0];
    if (kind !== 'interface' && kind !== 'type' && kind !== 'import') return false;
    if (kind === 'import' && tokens[i++]?.[0] !== 'type') return false;
    let depth = 0;
    let opened = false;
    for (; i < tokens.length; i++) {
      const token = tokens[i]![0];
      if (['{', '(', '[', '<'].includes(token)) { depth++; opened = true; }
      if (['}', ')', ']', '>'].includes(token)) depth--;
      if (depth < 0) return false;
      if (kind === 'interface' && opened && depth === 0) { i++; break; }
      if (token === ';' && depth === 0) { i++; break; }
      // Semicolon-free declarations. Continue union/intersection and conditional types.
      const next = tokens[i + 1];
      if (kind !== 'interface' && depth === 0 && next && /\n/.test(source.slice(tokens[i]!.index! + token.length, next.index))
        && !['=', '|', '&', ':', '?', ',', '=>', 'extends', 'in', 'keyof', 'typeof', 'infer'].includes(token)
        && !['|', '&', '[', '<', '.', '?', ':', '=', 'extends', ';'].includes(next[0])
        && (kind !== 'import' || /^["']/.test(token))) { i++; break; }
    }
    if (depth !== 0 || (kind === 'interface' && !opened)) return false;
  }
  return true;
}
