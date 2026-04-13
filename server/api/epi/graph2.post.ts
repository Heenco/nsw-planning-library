import { parseEPI2 } from '../../utils/epiParser2'

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) {
    throw createError({ statusCode: 400, statusMessage: 'No form data received' })
  }

  const filePart = form.find(p => p.name === 'file')
  if (!filePart?.data) {
    throw createError({ statusCode: 400, statusMessage: 'No file field in form data' })
  }

  const xmlString = Buffer.from(filePart.data).toString('utf-8')

  try {
    const graph = parseEPI2(xmlString)
    return graph
  } catch (err: any) {
    throw createError({
      statusCode: 422,
      statusMessage: err?.message ?? 'Failed to parse EPI XML',
    })
  }
})
