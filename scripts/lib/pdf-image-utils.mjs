/**
 * Minimal PNG encoder for the DCP conversion script.
 *
 * Encodes the raw raster data unpdf's extractImages() hands back into PNG
 * buffers we can write to disk. Ported from the same helper in the heenco
 * repo so this repo's pipeline is self-contained — the only dependency is
 * node:zlib.
 */

import { deflateSync } from 'node:zlib'

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : (crc >>> 1)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, Buffer.from(data)])), 0)
  return Buffer.concat([lenBuf, typeBuf, Buffer.from(data), crcBuf])
}

/**
 * Encode a raw decoded image into a PNG Buffer. Returns null when the data
 * is inconsistent with the declared dimensions or channel count — better to
 * drop a broken image than write garbage into the document.
 */
export function rawImageToPngBuffer(image) {
  const width = Number(image.width)
  const height = Number(image.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  const src = image.data instanceof Uint8ClampedArray
    ? image.data
    : new Uint8ClampedArray(image.data)
  const pixelCount = width * height
  const rgba = new Uint8Array(pixelCount * 4)

  if (image.channels === 4) {
    if (src.length < pixelCount * 4) return null
    for (let i = 0; i < pixelCount * 4; i++) rgba[i] = src[i]
  } else if (image.channels === 3) {
    if (src.length < pixelCount * 3) return null
    for (let i = 0; i < pixelCount; i++) {
      const s = i * 3
      const d = i * 4
      rgba[d] = src[s]
      rgba[d + 1] = src[s + 1]
      rgba[d + 2] = src[s + 2]
      rgba[d + 3] = 255
    }
  } else {
    // grayscale (1 channel)
    if (src.length < pixelCount) return null
    for (let i = 0; i < pixelCount; i++) {
      const gray = src[i]
      const d = i * 4
      rgba[d] = gray
      rgba[d + 1] = gray
      rgba[d + 2] = gray
      rgba[d + 3] = 255
    }
  }

  const stride = width * 4
  const scanlines = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1)
    scanlines[rowOffset] = 0 // filter: None
    Buffer.from(rgba.subarray(y * stride, y * stride + stride)).copy(scanlines, rowOffset + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // colour type: RGBA
  ihdr[10] = 0  // compression: deflate
  ihdr[11] = 0  // filter: adaptive
  ihdr[12] = 0  // interlace: none

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}
