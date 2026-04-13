import { parseEPI2 } from '../../utils/epiParser2'

export default defineEventHandler(async (event) => {
  const { epicode, dir, filename } = getQuery(event)
  if (!epicode || typeof epicode !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'epicode required' })
  }
  // Sanitise: only allow alphanumeric + hyphens to prevent path traversal
  const safe = epicode.replace(/[^a-z0-9\-]/gi, '')
  if (!safe) throw createError({ statusCode: 400, statusMessage: 'Invalid epicode' })

  const reqUrl = getRequestURL(event)

  // Support loading from SEPP directory with explicit filename
  let xmlUrl: string
  if (dir === 'SEPP' && typeof filename === 'string') {
    const safeFilename = filename.replace(/[^a-z0-9\-_.]/gi, '')
    xmlUrl = `${reqUrl.protocol}//${reqUrl.host}/EPI/SEPP/${safeFilename}`
  } else {
    xmlUrl = `${reqUrl.protocol}//${reqUrl.host}/EPI/xml/${safe}.xml`
  }

  let xml: string
  try {
    xml = await $fetch<string>(xmlUrl)
  } catch {
    throw createError({ statusCode: 404, statusMessage: `EPI file not found: ${safe}` })
  }

  try {
    return parseEPI2(xml)
  } catch (err: any) {
    throw createError({ statusCode: 422, statusMessage: err?.message ?? 'Failed to parse EPI XML' })
  }
})
