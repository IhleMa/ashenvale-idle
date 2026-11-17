// Readable JSON for content files: small objects/lists stay on one line, big ones are expanded.
const inline = v => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']');
export function pretty(value, indent = '', width = 120) {
  const one = typeof value === 'object' && value !== null ? inline(value) : JSON.stringify(value);
  if (one === undefined) return 'null';
  if (typeof value !== 'object' || value === null || indent.length + one.length <= width) return one;
  const next = indent + '  ';
  if (Array.isArray(value)) {
    // arrays of scalars: wrap lines
    if (value.every(v => typeof v !== 'object' || v === null)) {
      const parts = value.map(v => JSON.stringify(v));
      const lines = []; let line = '';
      for (const p of parts) { if ((next + line + p).length > width && line) { lines.push(line.trimEnd()); line = ''; } line += p + ', '; }
      if (line) lines.push(line.replace(/, $/, ''));
      return '[\n' + lines.map(l => next + l).join('\n') + '\n' + indent + ']';
    }
    return '[\n' + value.map(v => next + pretty(v, next, width)).join(',\n') + '\n' + indent + ']';
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return '{\n' + entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${pretty(v, next + ' '.repeat(k.length + 4).slice(0, 0), width)}`).join(',\n') + '\n' + indent + '}';
}
