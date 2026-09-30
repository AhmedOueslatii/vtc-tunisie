// drizzle-kit met les types custom entre guillemets ("geography(Point,4326)"), ce que Postgres
// interprète comme un nom de type littéral. On retire les guillemets dans les migrations générées.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../drizzle/', import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
  const path = new URL(file, dir);
  const sql = readFileSync(path, 'utf8');
  const fixed = sql.replace(/"((?:geography|geometry)\([^"]+\))"/g, '$1');
  if (fixed !== sql) writeFileSync(path, fixed);
}
