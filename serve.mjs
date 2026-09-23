/* A static server for dist/ so the built site can be looked at locally.
     node serve.mjs            http://localhost:4310
   No dependencies; not used by the deploy. */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = Number(process.env.PORT || 4310)
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.json': 'application/json' }

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p.endsWith('/')) p += 'index.html'
  const file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return }
  try {
    const s = await stat(file)
    if (s.isDirectory()) { res.writeHead(302, { location: p + '/' }).end(); return }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
    res.end(await readFile(file))
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found') }
}).listen(PORT, () => console.log(`serving dist/ at http://localhost:${PORT}`))
