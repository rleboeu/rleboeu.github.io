const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

/** Encodes `text` as UTF-8, then Base64. URL-safe output uses `-` and `_` and drops the `=` padding. */
export function encodeBase64(text: string, urlSafe: boolean): string {
  const bytes = utf8Encoder.encode(text)
  // Build the binary string in chunks: spreading a huge array into fromCharCode overflows the stack.
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  const encoded = btoa(binary)
  return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded
}

export type DecodeResult = { ok: true; text: string; bytes: number } | { ok: false; message: string }

/**
 * Decodes standard or URL-safe Base64 into UTF-8 text.
 * Ignores whitespace and line breaks, missing padding and a leading `data:…;base64,` prefix.
 */
export function decodeBase64(input: string): DecodeResult {
  const cleaned = input
    .trim()
    .replace(/^data:[^,]*;base64,/i, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/=+$/, '')

  const invalid = cleaned.match(/[^A-Za-z0-9+/]/)
  if (invalid) {
    return { ok: false, message: `"${invalid[0]}" isn't a Base64 character.` }
  }
  if (cleaned.length % 4 === 1) {
    return { ok: false, message: 'This Base64 looks incomplete, as if it was cut off or has a stray character.' }
  }

  const binary = atob(cleaned.padEnd(Math.ceil(cleaned.length / 4) * 4, '='))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  try {
    return { ok: true, text: utf8Decoder.decode(bytes), bytes: bytes.length }
  } catch {
    const size = bytes.length === 1 ? '1 byte' : `${bytes.length.toLocaleString()} bytes`
    return { ok: false, message: `This decodes to ${size} of binary data, not readable text.` }
  }
}

/** UTF-8 size of `text` in bytes. */
export function byteLength(text: string): number {
  return utf8Encoder.encode(text).length
}
