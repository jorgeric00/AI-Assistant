// Comprueba que el inglés tiene exactamente las mismas claves que el castellano en cada namespace.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath y no .pathname: en Windows .pathname da "/C:/...".
const dir = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url));
const keys = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
let problems = 0;
for (const file of readdirSync(join(dir, 'es'))) {
  const es = new Set(keys(JSON.parse(readFileSync(join(dir, 'es', file), 'utf8'))));
  const en = new Set(keys(JSON.parse(readFileSync(join(dir, 'en', file), 'utf8'))));
  for (const k of es) if (!en.has(k)) (problems++, console.error(`Falta en en/${file}: ${k}`));
  for (const k of en) if (!es.has(k)) (problems++, console.error(`Sobra en en/${file}: ${k}`));
}
if (problems) process.exit(1);
console.log('Traducciones completas.');
