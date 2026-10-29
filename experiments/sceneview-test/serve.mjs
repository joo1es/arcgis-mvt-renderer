/**
 * 零依赖静态服务器（为 SceneView A/B 测试提供同源瓦片）
 * 运行: node serve.mjs [port]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)))
const PORT = Number(process.argv[2] || 5199)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pbf': 'application/x-protobuf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let path = decodeURIComponent(url.pathname)
    if (path.endsWith('/')) path += 'index.html'

    const full = resolve(join(ROOT, path))
    if (!full.startsWith(ROOT + sep) && full !== ROOT) {
      res.writeHead(403).end('forbidden')
      return
    }

    const info = await stat(full)
    if (info.isDirectory()) {
      res.writeHead(302, { Location: path + '/' }).end()
      return
    }

    const body = await readFile(full)
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    })
    res.end(body)
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SceneView A/B 测试: http://localhost:${PORT}/`)
  console.log(`瓦片目录: ${join(ROOT, 'tiles')}`)
})
