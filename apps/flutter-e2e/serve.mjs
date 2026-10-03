/**
 * Sert un build Flutter web (`flutter build web`) avec les bons types MIME : le serveur de Python sous Windows envoie
 * le JavaScript en text/plain, que le navigateur refuse pour les modules.
 *
 *   node serve.mjs <dossier> <port>
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [dir, port] = process.argv.slice(2);
if (!dir || !port) {
  console.error('Usage : node serve.mjs <dossier> <port>');
  process.exit(1);
}
const root = resolve(dir);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.symbols': 'text/plain',
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = normalize(join(root, path === '/' ? 'index.html' : path));
  // Interdit de sortir du dossier servi
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  // Application monopage : toute route inconnue renvoie l'index
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(Number(port), () => console.log(`${root} → http://localhost:${port}`));
