export type FormatMode = 'beautify' | 'minify'

export interface FormatOptions {
  mode: FormatMode
  /** One level of indentation for `beautify`, e.g. two spaces or a tab. */
  indent: string
}

export type FormatResult =
  | {
      ok: true
      output: string
      /** What the input was validated as, e.g. "Valid JSON". */
      summary: string
      /** Problems that don't stop formatting, such as duplicate keys. */
      warnings: string[]
      /** What formatting dropped from the input, e.g. "comments removed". */
      outputNotes: string[]
    }
  | { ok: false; message: string; offset: number; line: number; column: number }

/** Converts a character offset into a 1-based line and column. */
export function position(text: string, offset: number): { line: number; column: number } {
  const lines = text.slice(0, offset).split(/\r\n|\r|\n/)
  return { line: lines.length, column: [...lines[lines.length - 1]].length + 1 }
}
