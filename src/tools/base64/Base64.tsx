import { useId, useState } from 'react'
import Pane from '../../components/Pane'
import { byteLength, decodeBase64, encodeBase64 } from './codec'

type Side = 'text' | 'base64'

export default function Base64() {
  const id = useId()
  // Whichever box was typed in last is the source; the other box shows its conversion.
  const [source, setSource] = useState<Side>('text')
  const [input, setInput] = useState('')
  const [urlSafe, setUrlSafe] = useState(false)

  const decoded = source === 'base64' && input.trim() ? decodeBase64(input) : null
  const text = source === 'text' ? input : decoded?.ok ? decoded.text : ''
  const base64 = source === 'base64' ? input : encodeBase64(input, urlSafe)
  const error = decoded && !decoded.ok ? decoded.message : null

  const edit = (side: Side, value: string) => {
    setSource(side)
    setInput(value)
  }

  const toggleUrlSafe = (next: boolean) => {
    setUrlSafe(next)
    // Rewrite pasted Base64 in the chosen alphabet so the toggle always has a visible effect.
    if (decoded?.ok) setInput(encodeBase64(decoded.text, next))
  }

  return (
    <section className="tool-page">
      <div className="tool-intro">
        <h1>Base64 Encoding</h1>
        <p className="muted">
          Type in either box to convert to the other. Everything runs in your browser.
        </p>
      </div>

      <div className="tool-toolbar">
        <label className="switch">
          <input type="checkbox" checked={urlSafe} onChange={(e) => toggleUrlSafe(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          <span>
            URL-safe <span className="muted switch-hint">(- and _, no padding)</span>
          </span>
        </label>
        <button type="button" className="button secondary" disabled={!input} onClick={() => edit(source, '')}>
          Clear
        </button>
      </div>

      <div className={`panes from-${source}`}>
        <Pane
          id={`${id}-text`}
          label="Plain text"
          value={text}
          placeholder="Type or paste text…"
          active={source === 'text'}
          onChange={(value) => edit('text', value)}
          meta={`${count([...text].length, 'character')} · ${count(byteLength(text), 'byte')}`}
          autoFocus
        />
        <div className="pane-direction" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </div>
        <Pane
          id={`${id}-base64`}
          label="Base64"
          value={base64}
          placeholder="…or paste Base64 to decode it"
          active={source === 'base64'}
          onChange={(value) => edit('base64', value)}
          meta={count(base64.replace(/\s+/g, '').length, 'character')}
          error={error}
          monospace
        />
      </div>
    </section>
  )
}

function count(n: number, unit: string): string {
  return `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`
}
