import { useEffect, useState, type ReactNode, type Ref } from 'react'

interface PaneProps {
  id: string
  label: string
  value: string
  placeholder: string
  active: boolean
  /** Omit to make the pane read-only. */
  onChange?: (value: string) => void
  /** Footer content, replaced by `error` when there is one. */
  meta: ReactNode
  error?: ReactNode
  monospace?: boolean
  /** Soft-wrap long lines. Turn off for indented code so it scrolls sideways instead. */
  wrap?: boolean
  autoFocus?: boolean
  textareaRef?: Ref<HTMLTextAreaElement>
}

/** A labelled text box with a Copy button and a status footer. */
export default function Pane({
  id,
  label,
  value,
  placeholder,
  active,
  onChange,
  meta,
  error,
  monospace,
  wrap = true,
  autoFocus,
  textareaRef,
}: PaneProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Clipboard access can be denied; the text is still there to select by hand.
    }
  }

  const classes = [monospace && 'monospace', !wrap && 'nowrap'].filter(Boolean).join(' ')

  return (
    <div className={`pane${active ? ' active' : ''}${error ? ' invalid' : ''}`}>
      <div className="pane-header">
        <label htmlFor={id}>{label}</label>
        <button type="button" className="pane-copy" disabled={!value} onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        className={classes || undefined}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        wrap={wrap ? 'soft' : 'off'}
        autoFocus={autoFocus}
        readOnly={!onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-status`}
        onChange={onChange && ((e) => onChange(e.target.value))}
      />
      <div id={`${id}-status`} className="pane-footer" aria-live="polite">
        {error ? <span className="error">{error}</span> : <span className="muted">{meta}</span>}
      </div>
    </div>
  )
}
