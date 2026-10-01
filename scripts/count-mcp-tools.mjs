// Посчитать реально зарегистрированные poe2_* тула по исходникам apps/mcp/src/tools.
import fs from 'node:fs';
const dir = new URL('../apps/mcp/src/tools/', import.meta.url);
const names = new Set();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
  const src = fs.readFileSync(new URL(f, dir), 'utf8');
  const text = fs.readFileSync(new URL(f, dir), 'utf8');
  for (const m of text.matchAll(/registerTool\(\s*'([a-z0-9_]+)'/g)) names.add(m[1]);
}
console.log('registered tools:', names.size);
console.log([...names].sort().join(' '));
