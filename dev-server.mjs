import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const pages = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/map.html', 'map.html']]);
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/config') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '' }));
    return;
  }
  const page = pages.get(pathname);
  if (!page) { response.writeHead(404); response.end('Not found'); return; }
  try {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(await readFile(path.join(root, page)));
  } catch {
    response.writeHead(500); response.end('Page unavailable');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Local preview: http://127.0.0.1:${port}/`);
});
