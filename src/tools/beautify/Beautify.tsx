import { useDeferredValue, useId, useMemo, useRef, useState } from 'react'
import Pane from '../../components/Pane'
import type { FormatMode } from './format'
import { indents, languages } from './languages'

const modes: { id: FormatMode; label: string }[] = [
  { id: 'beautify', label: 'Beautify' },
  { id: 'minify', label: 'Minify' },
]

export default function Beautify() {
  const id = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [languageId, setLanguageId] = useState(languages[0].id)
  const [mode, setMode] = useState<FormatMode>('beautify')
  const [indentId, setIndentId] = useState<string>(indents[0].id)
  const [input, setInput] = useState('')
  // Formatting a large paste can take a moment; keep typing responsive while it catches up.
  const source = useDeferredValue(input)

  const language = languages.find((l) => l.id === languageId) ?? languages[0]
  const indent = (indents.find((i) => i.id === indentId) ?? indents[0]).value
  const result = useMemo(
    () => (source.trim() ? language.format(source, { mode, indent }) : null),
    [language, source, mode, indent],
  )
  const output = result?.ok ? result.output : ''

  const showError = (offset: number) => {
    const textarea = inputRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(offset, Math.min(offset + 1, textarea.value.length))
  }

  let inputMeta = `Paste or type ${language.name} to check it`
  if (result?.ok) {
    const [warning, ...more] = result.warnings
    inputMeta = `✓ ${result.summary}`
    if (warning) inputMeta += ` · ${warning}${more.length ? ` (+${more.length} more)` : ''}`
  }

  const outputMeta = [count(output ? output.split('\n').length : 0, 'line'), count([...output].length, 'character')]
  if (result?.ok) {
    if (mode === 'minify' && source.length > output.length) {
      outputMeta.push(`${Math.round((1 - output.length / source.length) * 100)}% smaller`)
    }
    outputMeta.push(...result.outputNotes)
  }

  return (
    <section className="tool-page">
      <div className="tool-intro">
        <h1>Beautify</h1>
        <p className="muted">
          Validate {language.name}, then beautify it with readable indentation or minify it onto one line. Everything
          runs in your browser.
        </p>
      </div>

      <div className="tool-toolbar">
        <div className="tool-options">
          <label className="field">
            <span className="muted">Language</span>
            <select value={language.id} onChange={(e) => setLanguageId(e.target.value)}>
              {languages.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="radiogroup" aria-label="Output style">
            {modes.map((m) => (
              <label key={m.id}>
                <input
                  type="radio"
                  name={`${id}-mode`}
                  value={m.id}
                  checked={mode === m.id}
                  onChange={() => setMode(m.id)}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
          <label className="field">
            <span className="muted">Indent</span>
            <select value={indentId} disabled={mode === 'minify'} onChange={(e) => setIndentId(e.target.value)}>
              {indents.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="button secondary" disabled={!input} onClick={() => setInput('')}>
          Clear
        </button>
      </div>

      <div className="panes">
        <Pane
          id={`${id}-input`}
          label={language.name}
          value={input}
          placeholder={language.placeholder}
          active
          onChange={setInput}
          meta={inputMeta}
          error={
            result && !result.ok && (
              <>
                <button type="button" className="link-button" onClick={() => showError(result.offset)}>
                  Line {result.line}, column {result.column}
                </button>
                : {result.message}
              </>
            )
          }
          textareaRef={inputRef}
          monospace
          wrap={false}
          autoFocus
        />
        <div className="pane-direction" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </div>
        <Pane
          id={`${id}-output`}
          label={mode === 'minify' ? 'Minified' : 'Beautified'}
          value={output}
          placeholder={result && !result.ok ? 'Fix the error to see the result' : 'The result appears here'}
          active={false}
          meta={outputMeta.join(' · ')}
          monospace
          wrap={mode === 'minify'}
        />
      </div>
    </section>
  )
}

function count(n: number, unit: string): string {
  return `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`
}
