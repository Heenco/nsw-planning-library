import { readdirSync, openSync, readSync, closeSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'public', 'EPI', 'xml')

const files = readdirSync(dir).filter(f => f.endsWith('.xml')).sort()
const epis = files.map(f => {
  const code = f.replace(/\.xml$/, '')
  const buf = Buffer.alloc(512)
  const fd = openSync(join(dir, f), 'r')
  readSync(fd, buf, 0, 512, 0)
  closeSync(fd)
  const m = buf.toString('utf-8').match(/title="([^"]+)"/)
  return { code, title: m?.[1] ?? '' }
})

const outPath = join(root, 'public', 'EPI', 'epi-index.json')
writeFileSync(outPath, JSON.stringify(epis))
console.log(`Generated ${epis.length} entries → public/EPI/epi-index.json`)
