import { OPS, Util, type PDFPageProxy } from 'pdfjs-dist'

/** A straight horizontal or vertical line drawn on the page, in PDF points with the origin at the page's top-left. */
export interface Rule {
  vertical: boolean
  /** The line's x if it is vertical, otherwise its y. */
  at: number
  /** Where it starts and ends along its length (y if vertical, otherwise x). */
  from: number
  to: number
  /** Thickness in points. */
  width: number
  /** Hex color, e.g. "#000000". */
  color: string
}

/** A filled rectangle (cell shading, highlighting), in the same coordinates as {@link Rule}. */
export interface Fill {
  x0: number
  y0: number
  x1: number
  y1: number
  color: string
}

type Matrix = [number, number, number, number, number, number]
type Point = [number, number]

/** pdf.js's path commands inside a constructPath operation (its `DrawOPS`, which it does not export). */
const MOVE_TO = 0
const LINE_TO = 1
const CLOSE_PATH = 4

/** Filled rectangles at most this thick (in points) are drawn lines; Word, for one, draws table borders this way. */
const MAX_RULE_WIDTH = 3

const FILL_OPS = new Set<number>([
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
])
const STROKE_OPS = new Set<number>([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
])
const CLOSING_OPS = new Set<number>([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])

interface GraphicsState {
  ctm: Matrix
  lineWidth: number
  /** Empty when the color is a pattern or transparent. */
  fill: string
  stroke: string
}

/**
 * Reads the straight horizontal and vertical lines and the filled rectangles a page draws: the raw material of table
 * borders and shading. Curves, images, white fills and page-sized backgrounds are left out.
 */
export async function readShapes(page: PDFPageProxy): Promise<{ rules: Rule[]; fills: Fill[] }> {
  const viewport = page.getViewport({ scale: 1 })
  const { fnArray, argsArray } = await page.getOperatorList()
  const rules: Rule[] = []
  const fills: Fill[] = []

  let state: GraphicsState = { ctm: viewport.transform as Matrix, lineWidth: 1, fill: '#000000', stroke: '#000000' }
  const stack: GraphicsState[] = []
  const save = () => {
    stack.push(state)
    state = { ...state }
  }
  const restore = () => {
    state = stack.pop() ?? state
  }

  for (let i = 0; i < fnArray.length; i++) {
    const args = argsArray[i]
    switch (fnArray[i]) {
      case OPS.save:
        save()
        break
      case OPS.restore:
      case OPS.paintFormXObjectEnd:
        restore()
        break
      case OPS.paintFormXObjectBegin:
        save()
        if (args[0]) state.ctm = Util.transform(state.ctm, args[0]) as Matrix
        break
      case OPS.transform:
        state.ctm = Util.transform(state.ctm, args) as Matrix
        break
      case OPS.setLineWidth:
        state.lineWidth = args[0]
        break
      case OPS.setGState:
        for (const [key, value] of args[0]) if (key === 'LW') state.lineWidth = value
        break
      case OPS.setFillRGBColor:
        state.fill = typeof args[0] === 'string' ? args[0] : ''
        break
      case OPS.setStrokeRGBColor:
        state.stroke = typeof args[0] === 'string' ? args[0] : ''
        break
      case OPS.setFillColorN:
      case OPS.setFillTransparent:
        state.fill = ''
        break
      case OPS.setStrokeColorN:
      case OPS.setStrokeTransparent:
        state.stroke = ''
        break
      case OPS.constructPath: {
        const [paintOp, [data]] = args
        // Rendering can swap the raw path for a Path2D; only the raw form can be read.
        if (data instanceof Float32Array) addPath(paintOp, data, state, rules, fills)
        break
      }
    }
  }

  const pageArea = viewport.width * viewport.height
  return {
    rules: rules.filter((r) => r.color && r.to - r.from > 0),
    fills: fills.filter((f) => f.color && !/^#f{6}$/i.test(f.color) && (f.x1 - f.x0) * (f.y1 - f.y0) < pageArea * 0.9),
  }
}

function addPath(paintOp: number, data: Float32Array, state: GraphicsState, rules: Rule[], fills: Fill[]) {
  const paths = readPath(data)
  if (!paths) return
  const [a, b, c, d, e, f] = state.ctm
  const toPage = ([x, y]: Point): Point => [a * x + c * y + e, b * x + d * y + f]

  if (FILL_OPS.has(paintOp)) {
    for (const { points } of paths) {
      const rect = asRectangle(points.map(toPage))
      if (!rect) continue
      const [x0, y0, x1, y1] = rect
      const [w, h] = [x1 - x0, y1 - y0]
      if (Math.min(w, h) <= MAX_RULE_WIDTH) {
        const vertical = h > w
        rules.push(
          vertical
            ? { vertical, at: (x0 + x1) / 2, from: y0, to: y1, width: w, color: state.fill }
            : { vertical, at: (y0 + y1) / 2, from: x0, to: x1, width: h, color: state.fill },
        )
      } else {
        fills.push({ x0, y0, x1, y1, color: state.fill })
      }
    }
  }

  if (STROKE_OPS.has(paintOp)) {
    // Line width 0 means the thinnest line the device can draw.
    const width = Math.max(state.lineWidth * Math.sqrt(Math.abs(a * d - b * c)), 0.25)
    const color = state.stroke
    for (const { points, closed } of paths) {
      const onPage = points.map(toPage)
      if (closed || CLOSING_OPS.has(paintOp)) onPage.push(onPage[0])
      for (let k = 1; k < onPage.length; k++) {
        const [[xa, ya], [xb, yb]] = [onPage[k - 1], onPage[k]]
        if (Math.abs(xa - xb) < 0.5 && Math.abs(ya - yb) >= 0.5) {
          rules.push({ vertical: true, at: (xa + xb) / 2, from: Math.min(ya, yb), to: Math.max(ya, yb), width, color })
        } else if (Math.abs(ya - yb) < 0.5 && Math.abs(xa - xb) >= 0.5) {
          rules.push({ vertical: false, at: (ya + yb) / 2, from: Math.min(xa, xb), to: Math.max(xa, xb), width, color })
        }
      }
    }
  }
}

/** Splits path data into subpaths of points, or returns undefined for paths with curves. */
function readPath(data: Float32Array): { points: Point[]; closed: boolean }[] | undefined {
  const paths: { points: Point[]; closed: boolean }[] = []
  for (let i = 0; i < data.length; ) {
    switch (data[i++]) {
      case MOVE_TO:
        paths.push({ points: [[data[i++], data[i++]]], closed: false })
        break
      case LINE_TO: {
        const point: Point = [data[i++], data[i++]]
        if (paths.length === 0) paths.push({ points: [], closed: false })
        paths.at(-1)!.points.push(point)
        break
      }
      case CLOSE_PATH:
        if (paths.length > 0) paths.at(-1)!.closed = true
        break
      default:
        return undefined
    }
  }
  return paths.filter((p) => p.points.length > 1)
}

/** Returns [x0, y0, x1, y1] if the points trace an axis-aligned rectangle. */
function asRectangle(points: Point[]): [number, number, number, number] | undefined {
  const [first, last] = [points[0], points.at(-1)!]
  const corners = Math.abs(first[0] - last[0]) < 0.5 && Math.abs(first[1] - last[1]) < 0.5 ? points.slice(0, -1) : points
  if (corners.length !== 4) return undefined
  for (let k = 0; k < 4; k++) {
    const [[xa, ya], [xb, yb]] = [corners[k], corners[(k + 1) % 4]]
    if (Math.abs(xa - xb) >= 0.5 && Math.abs(ya - yb) >= 0.5) return undefined
  }
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
