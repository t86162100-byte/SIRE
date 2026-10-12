import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const DIST = join(process.cwd(), 'dist');

const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'};

async function serve(req, res) {
  if (!['GET','HEAD'].includes(req.method || '')) {
    res.writeHead(405, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Method Not Allowed'); return;
  }
  let pathname = '/';
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://sire.local').pathname); }
  catch { res.writeHead(400, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Bad Request'); return; }

  const safePath = normalize(pathname).replace(/^[/\\]+/, '');
  let filePath = join(DIST, safePath || 'index.html');
  try { const info = await stat(filePath); if (!info.isFile()) throw new Error('not a file'); }
  catch { filePath = join(DIST, 'index.html'); }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
    if (req.method === 'HEAD') res.end(); else res.end(data);
  } catch {
    res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Frontend asset unavailable');
  }
}

http.createServer(serve).listen(PORT, HOST, () => {
  console.log('[SIRE UI ONLY] Frontend server listening on ' + HOST + ':' + PORT);
});
