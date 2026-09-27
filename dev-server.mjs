import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { threeModules, readThreeModule } from './scripts/three-vendor.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const pages = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/map.html', 'map.html']]);
const assets = new Map([['/assets/editorial.css', 'text/css'], ['/assets/bay-scene.js', 'text/javascript']]);
assets.set('/assets/bay-city.js', 'text/javascript');
assets.set('/assets/insider-city.glb', 'model/gltf-binary');
assets.set('/assets/insider-city.png', 'image/png');
const vendor = new Map([...threeModules.keys()].map(name => [`/assets/${name}`, name]));
const port = Number(process.env.PORT || 4173);
const apiOrigin = 'https://insider-ingest.juanmontreuil71.workers.dev';

async function proxyApi(request, response, pathname) {
  const target = `${apiOrigin}${pathname}${request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''}`;
  const headers = new Headers(request.headers);
  headers.delete('host');
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request,
    duplex: 'half',
  });
  response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/config') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '' }));
    return;
  }
  if (['/data', '/notes'].includes(pathname) || pathname.startsWith('/note-images/') || pathname.startsWith('/thumbs/')) {
    try { await proxyApi(request, response, pathname); } catch { response.writeHead(502); response.end('API unavailable'); }
    return;
  }
  const page = vendor.get(pathname) || pages.get(pathname) || (assets.has(pathname) ? pathname.slice(1) : null);
  if (!page) { response.writeHead(404); response.end('Not found'); return; }
  try {
    response.writeHead(200, { 'Content-Type': `${vendor.has(pathname) ? 'text/javascript' : assets.get(pathname) || 'text/html'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(vendor.has(pathname) ? await readThreeModule(vendor.get(pathname)) : await readFile(path.join(root, page)));
  } catch {
    response.writeHead(500); response.end('Page unavailable');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Local preview: http://127.0.0.1:${port}/`);
});
