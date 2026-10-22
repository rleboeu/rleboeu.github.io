import { getDocument, GlobalWorkerOptions, PasswordException, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

/** Opens a PDF. Call `close` when done to free the document and its worker. */
export async function loadPdf(file: File): Promise<{ pdf: PDFDocumentProxy; close: () => Promise<void> }> {
  // fontExtraProperties keeps each font's name, which is the only reliable bold/italic signal for embedded fonts.
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), fontExtraProperties: true })
  try {
    return { pdf: await task.promise, close: () => task.destroy() }
  } catch (error) {
    await task.destroy()
    if (error instanceof PasswordException) {
      throw new Error('This PDF is password-protected, which is not supported.')
    }
    throw new Error(`Could not read this PDF: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export type FontFamily = 'serif' | 'sans-serif' | 'monospace'

/** A run of text on one line, in PDF points with the origin at the page's top-left. */
export interface TextSpan {
  text: string
  x: number
  /** Baseline, measured from the top of the page. */
  y: number
  width: number
  fontSize: number
  bold: boolean
  italic: boolean
  family: FontFamily
  /** The font's family name from the PDF (e.g. "Times New Roman"), when it has a usable one. */
  font?: string
}

export interface TextLine {
  /** Baseline, measured from the top of the page. */
  y: number
  x0: number
  x1: number
  /** Largest font size on the line. */
  fontSize: number
  spans: TextSpan[]
}

export interface PageLayout {
  width: number
  height: number
  lines: TextLine[]
  /** Typical width of one character on this page, used to turn horizontal gaps into spaces. */
  charWidth: number
}

/**
 * Reads a page's text and groups it into lines sorted top to bottom, left to right.
 * With `withFonts`, the page's fonts are loaded so bold/italic can be detected (slower).
 */
export async function readPageLayout(page: PDFPageProxy, { withFonts = false } = {}): Promise<PageLayout> {
  const viewport = page.getViewport({ scale: 1 })
  if (withFonts) await page.getOperatorList()
  const content = await page.getTextContent()

  const spans: TextSpan[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue
    const [a, b, c, d, e, f] = (item as TextItem).transform as number[]
    const [x, y] = viewport.convertToViewportPoint(e, f)
    const font = withFonts ? getFont(page, item.fontName) : undefined
    // pdf.js only sets bold/italic for fonts it has to substitute, so embedded fonts are judged by name.
    const fontName = font?.name ?? ''
    spans.push({
      text: item.str,
      x,
      y,
      width: item.width,
      fontSize: Math.hypot(c, d) || Math.hypot(a, b) || 12,
      bold: Boolean(font?.bold || font?.black) || /bold|black|heavy/i.test(fontName),
      italic: Boolean(font?.italic) || /italic|oblique/i.test(fontName),
      family: toFamily(content.styles[item.fontName]?.fontFamily),
      font: familyName(fontName),
    })
  }

  const charWidths = spans.filter((s) => s.text.length > 0).map((s) => s.width / s.text.length)
  return { width: viewport.width, height: viewport.height, lines: groupLines(spans), charWidth: median(charWidths) || 6 }
}

/** Groups spans into lines sorted top to bottom, each with its spans sorted left to right. */
export function groupLines(spans: readonly TextSpan[]): TextLine[] {
  const lines: TextLine[] = []
  for (const span of [...spans].sort((p, q) => p.y - q.y || p.x - q.x)) {
    // Items on the same line share a baseline (within a fraction of the font size; superscripts drift a bit).
    const line = lines.findLast((l) => Math.abs(l.y - span.y) < Math.min(l.fontSize, span.fontSize) * 0.5)
    if (line) {
      line.spans.push(span)
      line.fontSize = Math.max(line.fontSize, span.fontSize)
    } else {
      lines.push({ y: span.y, x0: 0, x1: 0, fontSize: span.fontSize, spans: [span] })
    }
  }
  for (const line of lines) {
    line.spans.sort((p, q) => p.x - q.x)
    line.x0 = line.spans[0].x
    line.x1 = Math.max(...line.spans.map((s) => s.x + s.width))
  }
  return lines.sort((p, q) => p.y - q.y)
}

/** Joins a line's spans into one string, inserting a space wherever there is a visible gap. */
export function lineText(line: TextLine): string {
  let text = ''
  let end = -Infinity
  for (const span of line.spans) {
    if (text && needsSpace(text, span, end)) text += ' '
    text += span.text
    end = span.x + span.width
  }
  return text
}

export function needsSpace(before: string, span: TextSpan, prevEnd: number): boolean {
  return span.x - prevEnd > span.fontSize * 0.15 && !/\s$/.test(before) && !/^\s/.test(span.text)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

interface FontInfo {
  /** PostScript name, e.g. "ABCDEF+Helvetica-Bold". Only present with `fontExtraProperties`. */
  name?: string
  bold?: boolean
  black?: boolean
  italic?: boolean
}

function getFont(page: PDFPageProxy, fontName: string): FontInfo | undefined {
  try {
    return page.commonObjs.has(fontName) ? (page.commonObjs.get(fontName) as FontInfo) : undefined
  } catch {
    return undefined
  }
}

/**
 * Turns a PostScript font name into the family name word processors know, e.g. "ABCDEF+TimesNewRomanPS-BoldMT"
 * becomes "Times New Roman". Returns undefined for placeholder names like "F1" that say nothing about the font.
 */
function familyName(postScriptName: string): string | undefined {
  const base = postScriptName
    .replace(/^[A-Z]{6}\+/, '') // subset prefix
    .split(/[-,]/)[0] // style suffix ("-Bold", ",Italic")
    .replace(/(PS)?MT$|PS$/, '') // Monotype/PostScript markers ("ArialMT")
  if (base.length < 3 || /^[A-Za-z]{1,3}\d+$/.test(base)) return undefined
  return base.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function toFamily(cssFamily: string | undefined): FontFamily {
  if (!cssFamily) return 'sans-serif'
  if (/mono|courier/i.test(cssFamily)) return 'monospace'
  if (/sans/i.test(cssFamily)) return 'sans-serif'
  if (/serif|times|georgia|garamond|roman/i.test(cssFamily)) return 'serif'
  return 'sans-serif'
}
