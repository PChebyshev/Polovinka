import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const qs = JSON.parse(readFileSync(join(here, '..', 'questions.json'), 'utf8'));
const ids = new Set();
const byLayer = {};
const byCat = {};
const problems = [];
for (const q of qs) {
  if (ids.has(q.id)) problems.push(`дубль id ${q.id}`);
  ids.add(q.id);
  for (const k of ['id', 'layer', 'category', 'text', 'a', 'b', 'topic']) {
    if (!q[k]) problems.push(`${q.id}: нет поля ${k}`);
  }
  if (!['light', 'us', 'deep'].includes(q.layer)) problems.push(`${q.id}: слой ${q.layer}`);
  byLayer[q.layer] = (byLayer[q.layer] ?? 0) + 1;
  byCat[q.category] = (byCat[q.category] ?? 0) + 1;
}
console.log(`Всего: ${qs.length}`);
console.log('По слоям:', byLayer);
console.log('По категориям:', byCat);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
