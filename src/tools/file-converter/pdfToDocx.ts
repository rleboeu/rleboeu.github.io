import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  TextWrappingType,
  VerticalAlignTable,
  VerticalPositionRelativeFrom,
  WidthType,
  type ISectionOptions,
  type TabStopDefinition,
} from 'docx'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { ConvertOptions } from './conversions'
import {
  groupLines,
  lineText,
  loadPdf,
  needsSpace,
  readPageLayout,
  type FontFamily,
  type PageLayout,
  type TextLine,
  type TextSpan,
} from './pdf'
import { readShapes, type Rule, type Fill } from './pdfShapes'
import { findTables, type Border, type Table as PdfTable, type TableCell as PdfTableCell } from './pdfTables'

/** Word measures in twentieths of a point. */
const TWIPS_PER_POINT = 20
/** Render scale for exact-layout page images (2 = 144 DPI). */
const IMAGE_SCALE = 2

const WORD_FONTS: Record<FontFamily, string> = {
  serif: 'Times New Roman',
  'sans-serif': 'Arial',
  monospace: 'Courier New',
}

export async function pdfToDocx(file: File, { mode = 'editable', onProgress }: ConvertOptions): Promise<Blob> {
  const { pdf, close } = await loadPdf(file)
  try {
    const sections: ISectionOptions[] = []
    let hasText = false
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress?.(n - 1, pdf.numPages)
      const page = await pdf.getPage(n)
      if (mode === 'exact') {
        sections.push(await imageSection(page))
      } else {
        const layout = await readPageLayout(page, { withFonts: true })
        hasText ||= layout.lines.length > 0
        sections.push(textSection(layout, await readShapes(page)))
      }
      page.cleanup()
    }
    onProgress?.(pdf.numPages, pdf.numPages)
    if (mode !== 'exact' && !hasText) {
      throw new Error('No text found. This PDF may be scanned images rather than text; try "Exact layout" instead.')
    }
    return await Packer.toBlob(new Document({ sections }))
  } finally {
    await close()
  }
}

function pageSize(width: number, height: number) {
  // docx swaps width and height for landscape pages, so always pass them portrait-first.
  const landscape = width > height
  return {
    width: Math.round(Math.min(width, height) * TWIPS_PER_POINT),
    height: Math.round(Math.max(width, height) * TWIPS_PER_POINT),
    orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
  }
}

async function imageSection(page: PDFPageProxy): Promise<ISectionOptions> {
  const viewport = page.getViewport({ scale: IMAGE_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
  const image = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not render page.'))), 'image/jpeg', 0.92),
  )
  canvas.width = canvas.height = 0

  const { width, height } = page.getViewport({ scale: 1 })
  const pointsToPixels = 96 / 72
  return {
    properties: {
      page: {
        size: pageSize(width, height),
        margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 },
      },
    },
    children: [
      new Paragraph({
        children: [
          new ImageRun({
            type: 'jpg',
            data: await image.arrayBuffer(),
            transformation: { width: width * pointsToPixels, height: height * pointsToPixels },
            // Anchored to the page corner rather than inline, so a full-page image never spills onto a blank page.
            floating: {
              horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
              verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
              wrap: { type: TextWrappingType.NONE },
              behindDocument: true,
            },
          }),
        ],
      }),
    ],
  }
}

const BULLET = /^\s*([•●▪◦○■□‣⁃\-–—*]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s/

/** Lines that read as one block of running text. */
interface Block {
  lines: TextLine[]
}

function textSection(layout: PageLayout, shapes: { rules: Rule[]; fills: Fill[] }): ISectionOptions {
  const { width, height } = layout
  const { tables, rest } = findTables(shapes.rules, shapes.fills, layout.lines.flatMap((l) => l.spans), layout)
  const lines = groupLines(rest)
  if (lines.length === 0 && tables.length === 0) {
    return { properties: { page: { size: pageSize(width, height) } }, children: [new Paragraph({})] }
  }

  const left = Math.min(...lines.map((l) => l.x0), ...tables.map((t) => t.xs[0]))
  const right = Math.max(...lines.map((l) => l.x1), ...tables.map((t) => t.xs.at(-1)!))
  const top = Math.min(...lines.map((l) => l.y - l.fontSize), ...tables.map((t) => t.ys[0]))
  const bottom = Math.max(...lines.map((l) => l.y), ...tables.map((t) => t.ys.at(-1)!))
  const clampMargin = (points: number) => Math.round(Math.min(Math.max(points, 18), 108) * TWIPS_PER_POINT)
  const margin = {
    left: clampMargin(left),
    // Ragged-right text ends short of the real margin, so assume the margins are symmetric unless text runs wider.
    right: clampMargin(Math.min(width - right, left)),
    top: clampMargin(top),
    bottom: clampMargin(height - bottom),
  }
  // Indents are measured from the margins Word actually uses, which may differ from the text's edges after clamping.
  const area: TextArea = {
    left: lines.length ? Math.min(...lines.map((l) => l.x0)) : left,
    right: lines.length ? Math.max(...lines.map((l) => l.x1)) : right,
    center: width / 2,
    innerLeft: margin.left / TWIPS_PER_POINT,
    innerRight: width - margin.right / TWIPS_PER_POINT,
  }

  // Lay out runs of lines and tables in the order they appear down the page.
  const children: (Paragraph | Table)[] = []
  let previousLine: TextLine | undefined
  let previousTableBottom: number | undefined
  let run: TextLine[] = []
  const flushLines = () => {
    for (const block of groupBlocks(run, area.left, area.right)) {
      const first = block.lines[0]
      const before = previousLine
        ? first.y - previousLine.y - first.fontSize * 1.2
        : previousTableBottom !== undefined
          ? first.y - first.fontSize - previousTableBottom
          : 0
      children.push(blockToParagraph(block, before, area))
      previousLine = block.lines.at(-1)
      previousTableBottom = undefined
    }
    run = []
  }
  const queue = [...tables]
  const addTable = (table: PdfTable) => {
    const above = previousLine
      ? table.ys[0] - (previousLine.y + previousLine.fontSize * 0.25)
      : previousTableBottom !== undefined
        ? table.ys[0] - previousTableBottom
        : 0
    // Word joins tables with nothing between them, so a table after a table always gets a spacer paragraph.
    if (above >= 1 || previousTableBottom !== undefined) children.push(spacer(above))
    children.push(toWordTable(table, area.innerLeft))
    previousLine = undefined
    previousTableBottom = table.ys.at(-1)!
  }
  for (const line of lines) {
    while (queue.length > 0 && queue[0].ys[0] < line.y - line.fontSize) {
      flushLines()
      addTable(queue.shift()!)
    }
    run.push(line)
  }
  flushLines()
  queue.forEach(addTable)
  // A page must end with a paragraph, not a table.
  if (children.at(-1) instanceof Table) children.push(spacer(1))

  return { properties: { page: { size: pageSize(width, height), margin } }, children }
}

/** An empty paragraph exactly `height` points tall, to reproduce a vertical gap. */
function spacer(height: number): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: twips(Math.max(height, 1)), lineRule: LineRuleType.EXACT },
  })
}

/** Where a stretch of text sits: the page body, or a table cell. All in points from the page's left edge. */
interface TextArea {
  /** Left and right edges of the text itself. */
  left: number
  right: number
  /** What centered text is centered on. */
  center: number
  /** The edges Word lays the text out between: the page margins, or a cell's padding. */
  innerLeft: number
  innerRight: number
}

function toWordTable(table: PdfTable, marginLeft: number): Table {
  const { xs, ys, cells } = table
  const padding = cellPadding(table)
  // A full grid of identical lines is declared once for the whole table, as Word itself does, so rows added later
  // get it too. Anything else is drawn cell by cell.
  const sides = cells.flatMap((c) => [c.borders.top, c.borders.right, c.borders.bottom, c.borders.left])
  const uniform = sides.every((b) => b && b.width === sides[0]!.width && b.color === sides[0]!.color)
  const gridLine = wordBorder(uniform ? sides[0] : undefined)
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: twips(xs.at(-1)! - xs[0]), type: WidthType.DXA },
    columnWidths: xs.slice(1).map((x, i) => twips(x - xs[i])),
    indent: { size: twips(xs[0] - marginLeft), type: WidthType.DXA },
    borders: uniform
      ? { top: gridLine, right: gridLine, bottom: gridLine, left: gridLine, insideHorizontal: gridLine, insideVertical: gridLine }
      : TableBorders.NONE,
    margins: { top: 0, bottom: 0, left: twips(padding), right: twips(padding) },
    rows: ys.slice(0, -1).map(
      (y, r) =>
        new TableRow({
          height: { value: twips(ys[r + 1] - y), rule: HeightRule.ATLEAST },
          cantSplit: true,
          children: cells.filter((c) => c.row === r).map((c) => toWordCell(c, padding, !uniform)),
        }),
    ),
  })
}

/** The gap between cell edges and their text, taken from the cell whose text comes closest to its left edge. */
function cellPadding({ xs, cells }: PdfTable): number {
  const gaps = cells.filter((c) => c.spans.length > 0).map((c) => Math.min(...c.spans.map((s) => s.x)) - c.x0)
  const narrowest = Math.min(...xs.slice(1).map((x, i) => x - xs[i]))
  return Math.min(Math.max(gaps.length ? Math.min(...gaps) : 2, 0), 12, narrowest * 0.3)
}

function toWordCell(cell: PdfTableCell, padding: number, withBorders: boolean): TableCell {
  const lines = groupLines(cell.spans)
  const area: TextArea = {
    left: cell.x0 + padding,
    right: cell.x1 - padding,
    center: (cell.x0 + cell.x1) / 2,
    innerLeft: cell.x0 + padding,
    innerRight: cell.x1 - padding,
  }
  const { verticalAlign, spaceBefore } = cellPlacement(cell, lines)
  // Wrapped lines end short of the cell's edge, so paragraphs are found against the text's own right edge.
  const blocks = groupBlocks(lines, area.left, lines.length ? Math.max(...lines.map((l) => l.x1)) : area.right)
  const paragraphs = blocks.map((block, i) => {
    const previous = blocks[i - 1]?.lines.at(-1)
    const first = block.lines[0]
    return blockToParagraph(block, previous ? first.y - previous.y - first.fontSize * 1.2 : spaceBefore, area)
  })
  return new TableCell({
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
    width: { size: twips(cell.x1 - cell.x0), type: WidthType.DXA },
    verticalAlign,
    shading: cell.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: cell.fill.slice(1) } : undefined,
    borders: withBorders
      ? {
          top: wordBorder(cell.borders.top),
          right: wordBorder(cell.borders.right),
          bottom: wordBorder(cell.borders.bottom),
          left: wordBorder(cell.borders.left),
        }
      : undefined,
    // A cell must hold a paragraph; an empty one is kept 1pt tall so the row's own height decides.
    children: paragraphs.length > 0 ? paragraphs : [spacer(1)],
  })
}

/** Whether a cell's text sits at its top, middle or bottom, and how far below the top edge when at the top. */
function cellPlacement(cell: PdfTableCell, lines: TextLine[]) {
  if (lines.length === 0) return { verticalAlign: VerticalAlignTable.TOP, spaceBefore: 0 }
  const [first, last] = [lines[0], lines.at(-1)!]
  const above = first.y - first.fontSize * 0.8 - cell.y0 // to roughly the top of the capitals
  const below = cell.y1 - (last.y + last.fontSize * 0.2)
  if (Math.abs(above - below) <= Math.max(2, (cell.y1 - cell.y0) * 0.1)) {
    return { verticalAlign: VerticalAlignTable.CENTER, spaceBefore: 0 }
  }
  if (above < below) {
    // Word's line box starts a little above the capitals.
    return { verticalAlign: VerticalAlignTable.TOP, spaceBefore: Math.max(0, above - first.fontSize * 0.2) }
  }
  return { verticalAlign: VerticalAlignTable.BOTTOM, spaceBefore: 0 }
}

function wordBorder(border: Border | undefined) {
  if (!border) return { style: BorderStyle.NONE, size: 0, color: 'auto' }
  // Word measures border widths in eighths of a point, from 2 to 96.
  const size = Math.min(Math.max(Math.round(border.width * 8), 2), 96)
  return { style: BorderStyle.SINGLE, size, color: border.color.slice(1) }
}

/** Spans of one line with no wide gap between them; wide gaps separate table columns or tab-aligned text. */
interface Segment {
  spans: TextSpan[]
  x0: number
  x1: number
}

function splitSegments(line: TextLine): Segment[] {
  const segments: Segment[] = []
  for (const span of line.spans) {
    const segment = segments.at(-1)
    if (segment && span.x - segment.x1 <= span.fontSize * 1.5) {
      segment.spans.push(span)
      segment.x1 = Math.max(segment.x1, span.x + span.width)
    } else {
      segments.push({ spans: [span], x0: span.x, x1: span.x + span.width })
    }
  }
  return segments
}

type Alignment = 'left' | 'center' | 'right'

/** Whether a stretch of text starting away from the left edge is centered in its area or flush with its right edge. */
function alignmentOf({ x0, x1 }: { x0: number; x1: number }, area: TextArea): Alignment {
  const { left, right, center } = area
  if (x0 <= left + (right - left) * 0.1) return 'left'
  if (Math.abs(x1 - right) <= 2) return 'right'
  if (Math.abs((x0 + x1) / 2 - center) < Math.max(2, (area.innerRight - area.innerLeft) * 0.02)) return 'center'
  return 'left'
}

function groupBlocks(lines: TextLine[], left: number, right: number): Block[] {
  const blocks: Block[] = []
  const textWidth = right - left
  for (const line of lines) {
    const block = blocks.at(-1)
    const prev = block?.lines.at(-1)
    if (block && prev && continuesBlock(block, prev, line, right, textWidth)) block.lines.push(line)
    else blocks.push({ lines: [line] })
  }
  return blocks
}

function continuesBlock(block: Block, prev: TextLine, line: TextLine, right: number, textWidth: number): boolean {
  const size = Math.max(prev.fontSize, line.fontSize)
  if (Math.abs(prev.fontSize - line.fontSize) > size * 0.1) return false
  if (BULLET.test(lineText(line))) return false
  // A line that stops well short of the right edge ends its paragraph.
  if (prev.x1 < right - textWidth * 0.15) return false

  const gap = line.y - prev.y
  const establishedGap = block.lines.length > 1 ? prev.y - block.lines.at(-2)!.y : undefined
  if (gap > (establishedGap ? establishedGap * 1.15 : size * 1.75)) return false

  if (block.lines.length === 1) {
    // Second line: flush with or left of the first (first-line indent), or a bullet's hanging indent.
    const tolerance = BULLET.test(lineText(prev)) ? size * 4 : 2
    return line.x0 <= prev.x0 + tolerance
  }
  return Math.abs(line.x0 - block.lines[1].x0) <= 2
}

const twips = (points: number) => Math.round(points * TWIPS_PER_POINT)

/** `before` is the space above the paragraph, in points. */
function blockToParagraph({ lines }: Block, before: number, area: TextArea): Paragraph {
  const first = lines[0]
  const segments = lines.map(splitSegments)
  // The whole paragraph is centered or right-aligned only when every line is a single stretch of text placed that way.
  const lineAlignments = segments.map((s) => (s.length === 1 ? alignmentOf(s[0], area) : 'left'))
  const alignment = lineAlignments.every((a) => a === lineAlignments[0]) ? lineAlignments[0] : 'left'

  const lineGap = lines.length > 1 ? lines[1].y - first.y : undefined
  const { runs, tabStops } = toRuns(segments, area)
  return new Paragraph({
    alignment: { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[alignment],
    indent: paragraphIndent(lines, alignment, area),
    spacing: {
      before: twips(Math.min(Math.max(before, 0), 72)),
      after: 0,
      ...(lineGap ? { line: twips(lineGap), lineRule: LineRuleType.AT_LEAST } : {}),
    },
    tabStops: tabStops.map(({ type, position }) => ({ type, position: twips(position) })),
    children: runs,
  })
}

function paragraphIndent(lines: TextLine[], alignment: Alignment, area: TextArea) {
  if (alignment === 'center') return undefined
  // Word right-aligns to its margin, which can sit right of where the text actually ended.
  if (alignment === 'right') return { right: Math.max(0, twips(area.innerRight - lines[0].x1)) }
  const first = lines[0]
  const bodyLeft = lines[1]?.x0 ?? first.x0
  const firstLineOffset = first.x0 - bodyLeft
  return {
    left: Math.max(0, twips(bodyLeft - area.innerLeft)),
    ...(firstLineOffset >= 0 ? { firstLine: twips(firstLineOffset) } : { hanging: twips(-firstLineOffset) }),
  }
}

interface RunStyle {
  bold: boolean
  italics: boolean
  size: number
  font: string
}

/**
 * Converts lines (already split into segments) to styled runs. Every segment after a line's first is reached by a tab,
 * whose stop keeps it centered or flush right when it was placed that way, so a right-aligned date stays at the right
 * edge even if Word's font is a little wider. Positions are in points from the area's inner left edge.
 */
function toRuns(lines: Segment[][], area: TextArea): { runs: TextRun[]; tabStops: TabStopDefinition[] } {
  const tabStops = new Map<number, TabStopDefinition['type']>()
  const runs: (RunStyle & { text: string })[] = []
  const append = (text: string, style: RunStyle) => {
    const last = runs.at(-1)
    if (last && last.bold === style.bold && last.italics === style.italics && last.size === style.size && last.font === style.font) {
      last.text += text
    } else {
      runs.push({ ...style, text })
    }
  }

  lines.forEach((segments, i) => {
    // Lines of one paragraph are joined with a space, except after a line-end hyphen.
    if (i > 0 && runs.length > 0 && !/[-\s]$/.test(runs.at(-1)!.text)) runs.at(-1)!.text += ' '
    segments.forEach((segment, j) => {
      let tab = ''
      if (j > 0) {
        const alignment = alignmentOf(segment, area)
        const [type, x] =
          alignment === 'right'
            ? [TabStopType.RIGHT, segment.x1]
            : alignment === 'center'
              ? [TabStopType.CENTER, (segment.x0 + segment.x1) / 2]
              : [TabStopType.LEFT, segment.x0]
        tabStops.set(Math.round(x - area.innerLeft), type)
        tab = '\t'
      }
      let segmentSoFar = ''
      let end = -Infinity
      for (const span of segment.spans) {
        const style: RunStyle = {
          bold: span.bold,
          italics: span.italic,
          size: Math.round(span.fontSize * 2), // half-points
          font: span.font ?? WORD_FONTS[span.family],
        }
        const text = (segmentSoFar && needsSpace(segmentSoFar, span, end) ? ' ' : '') + span.text
        // The segment's tab goes in front of its first span, in that span's style.
        append(tab + text, style)
        tab = ''
        segmentSoFar += text
        end = span.x + span.width
      }
    })
  })

  return {
    runs: runs.map(
      ({ text, bold, italics, ...style }) =>
        new TextRun({
          children: text.split('\t').flatMap((part, i) => (i ? [new Tab(), part] : [part])),
          // Omitted rather than false: some readers (macOS Quick Look, TextEdit) treat an explicit "false" as on.
          bold: bold || undefined,
          italics: italics || undefined,
          ...style,
        }),
    ),
    tabStops: [...tabStops].sort(([a], [b]) => a - b).map(([position, type]) => ({ type, position })),
  }
}
