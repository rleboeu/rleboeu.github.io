import type { ConvertOptions } from './conversions'

/**
 * Re-encodes an image in another format by drawing it onto a canvas.
 * Formats without transparency get `background` painted behind the image first.
 */
export async function convertImage(
  file: File,
  type: string,
  { quality, background }: ConvertOptions,
): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("This image couldn't be read. It may be damaged or not the format its name suggests.")
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not create a canvas to draw the image.')
    if (background) {
      context.fillStyle = background
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(bitmap, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality === undefined ? undefined : quality / 100),
    )
    if (!blob) throw new Error('The image could not be encoded. It may be too large for your browser.')
    // Browsers that can't encode a format fall back to PNG instead of failing.
    if (blob.type !== type) throw new Error(`Your browser can't save images as ${type}. Try another browser.`)
    return blob
  } finally {
    bitmap.close()
  }
}
