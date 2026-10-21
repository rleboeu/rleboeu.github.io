import { loadPdf, median, needsSpace, readPageLayout, type PageLayout } from './pdf'
import type { ConvertOptions } from './conversions'

/** Most blank lines kept for a vertical gap, so large empty areas don't become pages of blank lines. */
const MAX_BLANK_LINES = 3

/**
 * Extracts a PDF's text, keeping its layout as closely as plain text allows:
 * horizontal positions become columns of spaces and vertical gaps become blank lines.
 */
export async function pdfToTxt(file: File, { onProgress }: ConvertOptions): Promise<Blob> {
  const { pdf, close } = await loadPdf(file)
  try {
    const pages: string[] = []
    let hasText = false
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress?.(n - 1, pdf.numPages)
      const layout = await readPageLayout(await pdf.getPage(n))
      hasText ||= layout.lines.length > 0
      pages.push(layoutToText(layout))
    }
    onProgress?.(pdf.numPages, pdf.numPages)
    if (!hasText) throw new Error('No text found. This PDF may be scanned images rather than text.')
    return new Blob([pages.join('\n\n\n')], { type: 'text/plain;charset=utf-8' })
  } finally {
    await close()
  }
}

function layoutToText({ lines, charWidth }: PageLayout): string {
  if (lines.length === 0) return ''
  const left = Math.min(...lines.map((l) => l.x0))
  const lineSpacing = median(lines.slice(1).map((l, i) => l.y - lines[i].y)) || lines[0].fontSize * 1.2

  const out: string[] = []
  lines.forEach((line, i) => {
    if (i > 0) {
      const blanks = Math.round((line.y - lines[i - 1].y) / lineSpacing) - 1
      for (let b = 0; b < Math.min(blanks, MAX_BLANK_LINES); b++) out.push('')
    }

    let text = ''
    let end = -Infinity
    for (const span of line.spans) {
      // Align to a column only for indentation and wide gaps (tables, tab stops). Ordinary word gaps get one
      // space, since proportional fonts make column estimates drift within running text.
      const column = Math.round((span.x - left) / charWidth)
      const wideGap = !text || span.x - end > charWidth * 2
      if (wideGap && column > text.length) text = text.padEnd(column)
      else if (text && needsSpace(text, span, end)) text += ' '
      text += span.text
      end = span.x + span.width
    }
    out.push(text.trimEnd())
  })
  return out.join('\n')
}
