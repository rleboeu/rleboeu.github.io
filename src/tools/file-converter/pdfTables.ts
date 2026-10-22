import type { TextSpan } from './pdf'
import type { Fill, Rule } from './pdfShapes'

/** Lines this close (in points) count as one, e.g. the touching borders of two adjacent cells. */
const TOLERANCE = 2

export interface Border {
  width: number
  color: string
}

export interface TableCell {
  /** Position in the table's grid; a merged cell sits at its top-left grid cell. */
  row: number
  column: number
  rowSpan: number
  columnSpan: number
  x0: number
  y0: number
  x1: number
  y1: number
  borders: { top?: Border; right?: Border; bottom?: Border; left?: Border }
  /** Background color, if the cell is shaded. */
  fill?: string
  spans: TextSpan[]
}

/** A table drawn with ruled lines, in PDF points with the origin at the page's top-left. */
export interface Table {
  /** Grid line positions: column edges left to right, row edges top to bottom. */
  xs: number[]
  ys: number[]
  cells: TableCell[]
}

/**
 * Finds tables drawn as a grid of crossing horizontal and vertical lines, and moves the spans inside them into their
 * cells. Returns the tables top to bottom and the spans outside any table. Tables without vertical lines (only rows
 * ruled off) are not found.
 */
export function findTables(
  rules: Rule[],
  fills: Fill[],
  spans: TextSpan[],
  page: { width: number; height: number },
): { tables: Table[]; rest: TextSpan[] } {
  const merged = mergeRules(rules.filter((r) => r.to - r.from >= TOLERANCE))
  const tables: Table[] = []
  for (const cluster of crossingClusters(merged)) {
    const table = buildTable(cluster, fills)
    if (!table) continue
    const [x0, y0, x1, y1] = [table.xs[0], table.ys[0], table.xs.at(-1)!, table.ys.at(-1)!]
    // A frame around the whole page is decoration, not a table.
    if (x1 - x0 > page.width * 0.85 && y1 - y0 > page.height * 0.85) continue
    tables.push(table)
  }
  tables.sort((p, q) => p.ys[0] - q.ys[0])

  const cells = tables.flatMap((t) => t.cells)
  const rest: TextSpan[] = []
  for (const span of spans) {
    const x = span.x + span.width / 2
    const y = span.y - span.fontSize * 0.3 // middle of the letters, not the baseline
    const cell = cells.find((c) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1)
    if (cell) cell.spans.push(span)
    else rest.push(span)
  }
  return { tables, rest }
}

/** Joins lines that continue one another, like each cell's own copy of a shared border. */
function mergeRules(rules: Rule[]): Rule[] {
  const merged: Rule[] = []
  const sorted = [...rules].sort((p, q) => Number(p.vertical) - Number(q.vertical) || p.at - q.at || p.from - q.from)
  for (const rule of sorted) {
    const match = merged.find(
      (m) =>
        m.vertical === rule.vertical &&
        Math.abs(m.at - rule.at) <= TOLERANCE &&
        rule.from <= m.to + TOLERANCE &&
        rule.to >= m.from - TOLERANCE,
    )
    if (match) {
      match.from = Math.min(match.from, rule.from)
      match.to = Math.max(match.to, rule.to)
      match.width = Math.max(match.width, rule.width)
    } else {
      merged.push({ ...rule })
    }
  }
  return merged
}

function crosses(h: Rule, v: Rule): boolean {
  return (
    v.at >= h.from - TOLERANCE && v.at <= h.to + TOLERANCE && h.at >= v.from - TOLERANCE && h.at <= v.to + TOLERANCE
  )
}

/** Groups lines into sets connected by crossings; each set is a candidate table. */
function crossingClusters(rules: Rule[]): Rule[][] {
  const parent = rules.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  rules.forEach((h, i) => {
    if (h.vertical) return
    rules.forEach((v, j) => {
      if (v.vertical && crosses(h, v)) parent[root(i)] = root(j)
    })
  })
  const clusters = new Map<number, Rule[]>()
  rules.forEach((rule, i) => clusters.set(root(i), [...(clusters.get(root(i)) ?? []), rule]))
  return [...clusters.values()]
}

/** Sorted positions with near-duplicates collapsed. */
function distinct(values: number[]): number[] {
  const result: number[] = []
  for (const value of [...values].sort((a, b) => a - b)) {
    if (result.length === 0 || value - result.at(-1)! > TOLERANCE) result.push(value)
  }
  return result
}

/** The line along `at` covering from `from` to `to`, if there is one. */
function lineAlong(rules: Rule[], at: number, from: number, to: number): Rule | undefined {
  return rules.find(
    (r) => Math.abs(r.at - at) <= TOLERANCE && r.from <= from + TOLERANCE && r.to >= to - TOLERANCE,
  )
}

function buildTable(rules: Rule[], fills: Fill[]): Table | undefined {
  const horizontal = rules.filter((r) => !r.vertical)
  const vertical = rules.filter((r) => r.vertical)
  const xs = distinct(vertical.map((r) => r.at))
  const ys = distinct(horizontal.map((r) => r.at))
  const [columns, rows] = [xs.length - 1, ys.length - 1]
  if (columns < 1 || rows < 1 || columns * rows < 2) return undefined

  // Grid cells with no line between them belong to one merged cell.
  const parent = Array.from({ length: rows * columns }, (_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  const join = (a: number, b: number) => (parent[root(a)] = root(b))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      if (c + 1 < columns && !lineAlong(vertical, xs[c + 1], ys[r], ys[r + 1])) join(r * columns + c, r * columns + c + 1)
      if (r + 1 < rows && !lineAlong(horizontal, ys[r + 1], xs[c], xs[c + 1])) join(r * columns + c, (r + 1) * columns + c)
    }
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < rows * columns; i++) groups.set(root(i), [...(groups.get(root(i)) ?? []), i])

  const areas: { row: number; column: number; rowSpan: number; columnSpan: number }[] = []
  for (const members of groups.values()) {
    const rowsOf = members.map((i) => Math.floor(i / columns))
    const columnsOf = members.map((i) => i % columns)
    const [r0, r1, c0, c1] = [Math.min(...rowsOf), Math.max(...rowsOf), Math.min(...columnsOf), Math.max(...columnsOf)]
    if (members.length === (r1 - r0 + 1) * (c1 - c0 + 1)) {
      areas.push({ row: r0, column: c0, rowSpan: r1 - r0 + 1, columnSpan: c1 - c0 + 1 })
    } else {
      // An L-shaped gap in the lines can't be one Word cell, so keep its grid cells separate.
      for (const i of members) areas.push({ row: Math.floor(i / columns), column: i % columns, rowSpan: 1, columnSpan: 1 })
    }
  }

  const border = (rule: Rule | undefined): Border | undefined => rule && { width: rule.width, color: rule.color }
  const cells = areas.map(({ row, column, rowSpan, columnSpan }): TableCell => {
    const [x0, y0, x1, y1] = [xs[column], ys[row], xs[column + columnSpan], ys[row + rowSpan]]
    // The last fill drawn over the whole cell is the one that shows.
    const fill = fills.findLast(
      (f) => f.x0 <= x0 + TOLERANCE && f.x1 >= x1 - TOLERANCE && f.y0 <= y0 + TOLERANCE && f.y1 >= y1 - TOLERANCE,
    )
    return {
      row,
      column,
      rowSpan,
      columnSpan,
      x0,
      y0,
      x1,
      y1,
      borders: {
        top: border(lineAlong(horizontal, y0, x0, x1)),
        right: border(lineAlong(vertical, x1, y0, y1)),
        bottom: border(lineAlong(horizontal, y1, x0, x1)),
        left: border(lineAlong(vertical, x0, y0, y1)),
      },
      fill: fill?.color,
      spans: [],
    }
  })
  cells.sort((p, q) => p.row - q.row || p.column - q.column)
  return { xs, ys, cells }
}
