import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'
import type { ImageFormat } from '@setu/core'

function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xed_b8_83_20 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

/** A deterministic gradient RGB PNG of the given size — a real, decodable image with
 *  enough detail that lossy re-encoding at different qualities yields different sizes. */
export function makeTestPng(width: number, height: number): Uint8Array {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * 3)
    raw[off] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * 3
      raw[p] = (x * 37 + y * 17) & 255
      raw[p + 1] = (x * x + y * 3) & 255
      raw[p + 2] = ((x ^ y) * 53) & 255
    }
  }
  const idat = deflateSync(raw, { level: 9 })
  return new Uint8Array(
    Buffer.concat([
      sig,
      chunk('IHDR', ihdr),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0))
    ])
  )
}

/** Identify an encoded image's format from its magic bytes (version-independent —
 *  unlike sharp's metadata().format, which reports HEIF/AVIF inconsistently). */
export function detectFormat(b: Uint8Array): ImageFormat | null {
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47
  )
    return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return 'jpeg'
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50 // "WEBP"
  )
    return 'webp'
  if (
    b.length >= 12 &&
    b[4] === 0x66 &&
    b[5] === 0x74 &&
    b[6] === 0x79 &&
    b[7] === 0x70
  ) {
    // ISO-BMFF "ftyp" box — AVIF major/compatible brand begins "avi" (avif/avis)
    if (b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69) return 'avif'
  }
  return null
}
