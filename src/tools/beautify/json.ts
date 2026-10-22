import { position, type FormatOptions, type FormatResult } from './format'

/*
 * A hand-written JSON parser rather than JSON.parse, so that:
 * - errors point at a line and column with a useful explanation,
 * - JSONC extras (comments and trailing commas) are accepted,
 * - output reuses the source text of every string and number, so big integers,
 *   `1.0` and escapes like `é` come out exactly as they went in.
 */

type TokenKind = 'punctuation' | 'string' | 'number' | 'literal' | 'comment'

interface Token {
  kind: TokenKind
  text: string
  start: number
  /** Whether a line break separates this token from the one before it in the source. */
  newlineBefore: boolean
}

interface Parsed {
  /** Every token in source order, comments included. */
  tokens: Token[]
  /** Indexes into `tokens` of commas directly before a closing bracket. */
  trailingCommas: Set<number>
  warnings: string[]
}

class JsonError extends Error {
  offset: number

  constructor(message: string, offset: number) {
    super(message)
    this.offset = offset
  }
}

export function formatJson(input: string, { mode, indent }: FormatOptions): FormatResult {
  let parsed: Parsed
  try {
    parsed = parse(input)
  } catch (error) {
    if (error instanceof JsonError) return { ok: false, message: error.message, offset: error.offset, ...position(input, error.offset) }
    if (error instanceof RangeError) {
      return { ok: false, message: 'This JSON is nested too deeply to format.', offset: 0, line: 1, column: 1 }
    }
    throw error
  }

  const { tokens, trailingCommas, warnings } = parsed
  const hasComments = tokens.some((token) => token.kind === 'comment')
  const extras = [hasComments && 'comments', trailingCommas.size > 0 && 'trailing commas'].filter((extra) => extra !== false)
  const outputNotes: string[] = []
  if (hasComments && mode === 'minify') outputNotes.push('comments removed')
  if (trailingCommas.size > 0) outputNotes.push('trailing commas removed')

  return {
    ok: true,
    output: mode === 'minify' ? minify(tokens, trailingCommas) : beautify(tokens, trailingCommas, indent),
    summary: extras.length ? `Valid JSONC (has ${extras.join(' and ')})` : 'Valid JSON',
    warnings,
    outputNotes,
  }
}

/** Joins every value and punctuation token with no whitespace. Whitespace inside strings is part of the string token, so it survives. */
function minify(tokens: Token[], skip: Set<number>): string {
  return tokens
    .filter((token, index) => token.kind !== 'comment' && !skip.has(index))
    .map((token) => token.text)
    .join('')
}

/** One entry per line, nested `indent` deeper per level, keeping comments where they were. */
function beautify(tokens: Token[], skip: Set<number>, indent: string): string {
  // Move each comma ahead of any comments before it, so `1 // note` followed by `, 2` prints as `1, // note`.
  const ordered: Token[] = []
  tokens.forEach((token, index) => {
    if (skip.has(index)) return
    if (token.kind === 'punctuation' && token.text === ',') {
      let at = ordered.length
      while (at > 0 && ordered[at - 1].kind === 'comment') at--
      ordered.splice(at, 0, token)
    } else {
      ordered.push(token)
    }
  })

  let out = ''
  let depth = 0
  let breakLine = false
  let space = false
  const write = (text: string) => {
    if (breakLine && out) out += '\n' + indent.repeat(depth)
    else if (space) out += ' '
    breakLine = space = false
    out += text
  }

  for (let i = 0; i < ordered.length; i++) {
    const token = ordered[i]
    if (token.kind === 'comment') {
      const text = token.text.trimEnd()
      if (token.newlineBefore || !out) {
        // A comment on a line of its own stays on its own line.
        breakLine = true
        write(text)
        breakLine = true
      } else {
        // A comment after code on the same line stays at the end of that line.
        out += ' ' + text
        if (text.startsWith('//')) breakLine = true
        else space = true
      }
      continue
    }
    if (token.kind !== 'punctuation') {
      write(token.text)
      continue
    }
    switch (token.text) {
      case '{':
      case '[': {
        write(token.text)
        const next = ordered[i + 1]
        if (next?.kind === 'punctuation' && next.text === (token.text === '{' ? '}' : ']')) {
          out += next.text
          i++
        } else {
          depth++
          breakLine = true
        }
        break
      }
      case '}':
      case ']':
        depth--
        breakLine = true
        write(token.text)
        break
      case ',':
        write(',')
        breakLine = true
        break
      case ':':
        write(':')
        space = true
        break
    }
  }
  return out
}

function parse(src: string): Parsed {
  const tokens: Token[] = []
  const trailingCommas = new Set<number>()
  const warnings: string[] = []
  let pos = 0
  /** Index in `tokens` of the next non-comment token, -1 at the end, or undefined until it's read. */
  let current: number | undefined
  let lastEnd = 0

  const lineAt = (offset: number) => position(src, offset).line

  function lex(): Token | undefined {
    let newlineBefore = tokens.length === 0
    while (pos < src.length) {
      const ch = src[pos]
      if (ch === '\n' || ch === '\r') newlineBefore = true
      else if (ch !== ' ' && ch !== '\t' && !(ch === '﻿' && pos === 0)) break
      pos++
    }
    if (pos >= src.length) return undefined

    const start = pos
    const ch = src[pos]
    let kind: TokenKind
    if ('{}[]:,'.includes(ch)) {
      kind = 'punctuation'
      pos++
    } else if (ch === '"') {
      kind = 'string'
      pos = scanString(src, pos)
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      kind = 'number'
      pos = scanNumber(src, pos)
    } else if (ch === '/' && src[pos + 1] === '/') {
      kind = 'comment'
      while (pos < src.length && src[pos] !== '\n' && src[pos] !== '\r') pos++
    } else if (ch === '/' && src[pos + 1] === '*') {
      kind = 'comment'
      const end = src.indexOf('*/', pos + 2)
      if (end === -1) throw new JsonError('This /* comment is never closed with */.', start)
      pos = end + 2
    } else if (/[A-Za-z_$]/.test(ch)) {
      kind = 'literal'
      pos = scanWord(src, pos)
    } else {
      throw new JsonError(unexpectedCharacter(src, pos), pos)
    }

    const token: Token = { kind, text: src.slice(start, pos), start, newlineBefore }
    tokens.push(token)
    return token
  }

  function peek(): Token | undefined {
    if (current === undefined) {
      let token: Token | undefined
      do token = lex()
      while (token?.kind === 'comment')
      current = token ? tokens.length - 1 : -1
    }
    return current >= 0 ? tokens[current] : undefined
  }

  function advance() {
    const token = peek()
    if (token) lastEnd = token.start + token.text.length
    current = undefined
  }

  function fail(expected: string, found: Token | undefined): never {
    const startsValue = found && (found.kind !== 'punctuation' || found.text === '{' || found.text === '[')
    const hint = expected.startsWith('","') && startsValue ? ' Is a comma missing before it?' : ''
    throw new JsonError(`Expected ${expected} but found ${describe(found)}.${hint}`, found ? found.start : lastEnd)
  }

  function parseValue() {
    const token = peek()
    if (token?.kind === 'punctuation' && (token.text === '{' || token.text === '[')) {
      parseContainer(token)
    } else if (token && token.kind !== 'punctuation') {
      advance()
    } else {
      fail('a value', token)
    }
  }

  function parseContainer(open: Token) {
    const isObject = open.text === '{'
    const close = isObject ? '}' : ']'
    const closes = (token: Token | undefined) => token?.kind === 'punctuation' && token.text === close
    const keys = new Set<string>()
    advance()
    if (closes(peek())) return advance()

    for (;;) {
      if (isObject) {
        const key = peek()
        if (key?.kind !== 'string') fail('a property name in double quotes', key)
        const name = JSON.parse(key.text) as string
        if (keys.has(name)) warnings.push(`Duplicate key ${key.text} on line ${lineAt(key.start)}`)
        keys.add(name)
        advance()
        const colon = peek()
        if (colon?.kind !== 'punctuation' || colon.text !== ':') fail('":" after the property name', colon)
        advance()
      }
      parseValue()

      const separator = peek()
      if (closes(separator)) return advance()
      if (separator?.kind !== 'punctuation' || separator.text !== ',') {
        fail(`"," or "${close}" to close the "${open.text}" on line ${lineAt(open.start)}`, separator)
      }
      const comma = current!
      advance()
      if (closes(peek())) {
        trailingCommas.add(comma)
        return advance()
      }
    }
  }

  if (!peek()) throw new JsonError(tokens.length ? 'There is no JSON value here, only comments.' : 'There is no JSON here.', 0)
  parseValue()
  const extra = peek()
  if (extra) {
    throw new JsonError(
      `Unexpected ${describe(extra)} after the end of the JSON. Only one top-level value is allowed; wrap several in [ ].`,
      extra.start,
    )
  }
  return { tokens, trailingCommas, warnings }
}

/** Returns the offset just past the string starting at `start`, checking every escape. */
function scanString(src: string, start: number): number {
  let i = start + 1
  for (;;) {
    if (i >= src.length) throw new JsonError('This string is never closed with a double quote.', start)
    const ch = src[i]
    if (ch === '"') return i + 1
    if (ch === '\\') {
      const escape = src[i + 1] ?? ''
      if (escape && '"\\/bfnrt'.includes(escape)) {
        i += 2
      } else if (escape === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
          throw new JsonError('"\\u" must be followed by four hex digits, like \\u00e9.', i)
        }
        i += 6
      } else {
        throw new JsonError(`"\\${escape}" isn't a valid escape. Use \\\\ for a literal backslash.`, i)
      }
    } else if (ch === '\n' || ch === '\r') {
      throw new JsonError('Line break inside a string. Is a closing quote missing? Write line breaks as \\n.', i)
    } else if (ch === '\t') {
      throw new JsonError('Tab character inside a string. Write tabs as \\t.', i)
    } else if (ch < ' ') {
      throw new JsonError(`Control character ${codePoint(ch)} inside a string must be escaped.`, i)
    } else {
      i++
    }
  }
}

const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y

function scanNumber(src: string, start: number): number {
  numberPattern.lastIndex = start
  if (numberPattern.test(src) && !/[\w.]/.test(src.charAt(numberPattern.lastIndex))) return numberPattern.lastIndex

  const run = src.slice(start).match(/^[\w.+-]*/)![0]
  if (/^-?0\d/.test(run)) throw new JsonError(`Numbers can't have leading zeros: ${run}`, start)
  if (/^-?(Infinity|NaN)$/.test(run)) throw new JsonError(`${run} isn't allowed in JSON. Use null or a string.`, start)
  throw new JsonError(`${run} isn't a valid JSON number.`, start)
}

function scanWord(src: string, start: number): number {
  const end = start + src.slice(start).match(/^[\w$]*/)![0].length
  const word = src.slice(start, end)
  if (word === 'true' || word === 'false' || word === 'null') return end

  const lower = word.toLowerCase()
  let message: string
  if (/^\s*:/.test(src.slice(end))) message = `Property names must be in double quotes: "${word}"`
  else if (lower === 'true' || lower === 'false' || lower === 'null') message = `JSON is case-sensitive. Use ${lower} instead of ${word}.`
  else if (word === 'undefined') message = "undefined isn't a JSON value. Use null instead."
  else if (word === 'NaN' || word === 'Infinity') message = `${word} isn't allowed in JSON. Use null or a string.`
  else message = `Unexpected ${word}. Text values must be in double quotes: "${word}"`
  throw new JsonError(message, start)
}

function unexpectedCharacter(src: string, pos: number): string {
  const ch = String.fromCodePoint(src.codePointAt(pos)!)
  if (ch === "'") return 'Strings must use double quotes (") instead of single quotes.'
  if (ch === '.' && /\d/.test(src.charAt(pos + 1))) return 'Numbers need a digit before the decimal point, like 0.5.'
  if (ch === '+') return 'Numbers can\'t start with "+".'
  if (ch === '=') return 'Unexpected "=". Use ":" between a property name and its value.'
  if (/[\s\p{C}]/u.test(ch)) return `Unexpected invisible character ${codePoint(ch)}.`
  return `Unexpected character "${ch}".`
}

function describe(token: Token | undefined): string {
  if (!token) return 'the end of the input'
  const text = token.text.length > 24 ? `${token.text.slice(0, 20)}…` : token.text
  if (token.kind === 'string') return `the string ${text}`
  if (token.kind === 'number') return `the number ${text}`
  if (token.kind === 'literal') return text
  return `"${text}"`
}

function codePoint(ch: string): string {
  return `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
}
