import {
  AlignmentType,
  Document,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  Packer,
  PageOrientation,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  type ISectionOptions,
  type TabStopDefinition,
} from 'docx'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { ConvertOptions } from './conversions'
import {
  lineText,
  loadPdf,
  needsSpace,
  readPageLayout,
  type FontFamily,
  type PageLayout,
  type TextLine,
  type TextSpan,
} from './pdf'

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
        sections.push(textSection(layout))
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

function textSection(layout: PageLayout): ISectionOptions {
  const { lines, width, height } = layout
  if (lines.length === 0) {
    return { properties: { page: { size: pageSize(width, height) } }, children: [new Paragraph({})] }
  }

  const left = Math.min(...lines.map((l) => l.x0))
  const right = Math.max(...lines.map((l) => l.x1))
  const clampMargin = (points: number) => Math.round(Math.min(Math.max(points, 18), 108) * TWIPS_PER_POINT)
  const margin = {
    left: clampMargin(left),
    // Ragged-right text ends short of the real margin, so assume the margins are symmetric unless text runs wider.
    right: clampMargin(Math.min(width - right, left)),
    top: clampMargin(lines[0].y - lines[0].fontSize),
    bottom: clampMargin(height - lines[lines.length - 1].y),
  }
  // Indents are measured from the margins Word actually uses, which may differ from the text's edges after clamping.
  const page: PageGeometry = {
    left,
    right,
    pageWidth: width,
    marginLeft: margin.left / TWIPS_PER_POINT,
    marginRight: margin.right / TWIPS_PER_POINT,
  }

  const blocks = groupBlocks(lines, left, right)
  return {
    properties: { page: { size: pageSize(width, height), margin } },
    children: blocks.map((block, i) => blockToParagraph(block, blocks[i - 1]?.lines.at(-1), page)),
  }
}

interface PageGeometry {
  /** Left and right edges of the page's text. */
  left: number
  right: number
  pageWidth: number
  marginLeft: number
  marginRight: number
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

/** Whether a stretch of text starting away from the left edge is centered on the page or flush with the right edge. */
function alignmentOf({ x0, x1 }: { x0: number; x1: number }, { left, right, pageWidth }: PageGeometry): Alignment {
  if (x0 <= left + (right - left) * 0.1) return 'left'
  if (Math.abs(x1 - right) <= 2) return 'right'
  if (Math.abs((x0 + x1) / 2 - pageWidth / 2) < pageWidth * 0.02) return 'center'
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

function blockToParagraph({ lines }: Block, previous: TextLine | undefined, page: PageGeometry): Paragraph {
  const first = lines[0]
  const segments = lines.map(splitSegments)
  // The whole paragraph is centered or right-aligned only when every line is a single stretch of text placed that way.
  const lineAlignments = segments.map((s) => (s.length === 1 ? alignmentOf(s[0], page) : 'left'))
  const alignment = lineAlignments.every((a) => a === lineAlignments[0]) ? lineAlignments[0] : 'left'

  const lineGap = lines.length > 1 ? lines[1].y - first.y : undefined
  const before = previous ? first.y - previous.y - first.fontSize * 1.2 : 0
  const { runs, tabStops } = toRuns(segments, page)
  return new Paragraph({
    alignment: { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[alignment],
    indent: paragraphIndent(lines, alignment, page),
    spacing: {
      before: twips(Math.min(Math.max(before, 0), 72)),
      after: 0,
      ...(lineGap ? { line: twips(lineGap), lineRule: LineRuleType.AT_LEAST } : {}),
    },
    tabStops: tabStops.map(({ type, position }) => ({ type, position: twips(position) })),
    children: runs,
  })
}

function paragraphIndent(lines: TextLine[], alignment: Alignment, page: PageGeometry) {
  if (alignment === 'center') return undefined
  // Word right-aligns to its margin, which can sit right of where the text actually ended.
  if (alignment === 'right') return { right: Math.max(0, twips(page.pageWidth - page.marginRight - lines[0].x1)) }
  const first = lines[0]
  const bodyLeft = lines[1]?.x0 ?? first.x0
  const firstLineOffset = first.x0 - bodyLeft
  return {
    left: Math.max(0, twips(bodyLeft - page.marginLeft)),
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
 * edge even if Word's font is a little wider. Positions are in points from the left margin.
 */
function toRuns(lines: Segment[][], page: PageGeometry): { runs: TextRun[]; tabStops: TabStopDefinition[] } {
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
        const alignment = alignmentOf(segment, page)
        const [type, x] =
          alignment === 'right'
            ? [TabStopType.RIGHT, segment.x1]
            : alignment === 'center'
              ? [TabStopType.CENTER, (segment.x0 + segment.x1) / 2]
              : [TabStopType.LEFT, segment.x0]
        tabStops.set(Math.round(x - page.marginLeft), type)
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
