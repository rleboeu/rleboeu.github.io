import { useEffect, useId, useState, type DragEvent } from 'react'
import { findConversion, sourceFormats, targetsFor } from './conversions'

type Status =
  | { state: 'idle' }
  | { state: 'converting'; done: number; total: number }
  | { state: 'done'; url: string; filename: string }
  | { state: 'error'; message: string }

export default function FileConverter() {
  const id = useId()
  const [fromId, setFromId] = useState(sourceFormats[0].id)
  const [toId, setToId] = useState(targetsFor(sourceFormats[0])[0].id)
  const [mode, setMode] = useState<string | undefined>()
  const [quality, setQuality] = useState(92)
  const [background, setBackground] = useState('#ffffff')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState<Status>({ state: 'idle' })

  const from = sourceFormats.find((f) => f.id === fromId) ?? sourceFormats[0]
  const targets = targetsFor(from)
  const to = targets.find((f) => f.id === toId) ?? targets[0]
  const conversion = findConversion(from, to)
  const modes = conversion?.modes
  const activeMode = modes?.some((m) => m.id === mode) ? mode : modes?.[0].id
  const settings = conversion?.settings ?? []
  const extensions = from.accept.split(',').filter((a) => a.startsWith('.'))

  // Free the previous download whenever a new result replaces it.
  useEffect(() => {
    if (status.state !== 'done') return
    return () => URL.revokeObjectURL(status.url)
  }, [status])

  const reset = () => setStatus({ state: 'idle' })

  const changeFrom = (id: string) => {
    setFromId(id)
    setFile(null)
    reset()
  }

  const chooseFile = (chosen: File | undefined) => {
    if (!chosen) return
    if (!extensions.some((ext) => chosen.name.toLowerCase().endsWith(ext))) {
      setStatus({ state: 'error', message: `That doesn't look like a ${from.label}. Choose a ${extensions.join(' or ')} file.` })
      return
    }
    setFile(chosen)
    reset()
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files[0])
  }

  const convert = async () => {
    if (!conversion || !file) return
    setStatus({ state: 'converting', done: 0, total: 0 })
    try {
      const blob = await conversion.convert(file, {
        mode: activeMode,
        quality: settings.includes('quality') ? quality : undefined,
        background: settings.includes('background') ? background : undefined,
        onProgress: (done, total) => setStatus({ state: 'converting', done, total }),
      })
      const filename = `${file.name.replace(/\.[^.]+$/, '')}.${to.extension}`
      setStatus({ state: 'done', url: URL.createObjectURL(blob), filename })
    } catch (error) {
      setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const converting = status.state === 'converting'

  return (
    <section className="converter">
      <h1>File Converter</h1>
      <p className="muted">Conversion runs in your browser; your files never leave your device.</p>

      <div className="converter-formats">
        <label>
          I have a
          <select
            value={from.id}
            disabled={converting}
            onChange={(e) => changeFrom(e.target.value)}
          >
            {sourceFormats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          I want a
          <select
            value={to.id}
            disabled={converting}
            onChange={(e) => {
              setToId(e.target.value)
              reset()
            }}
          >
            {targets.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {modes && (
        <fieldset className="converter-modes" disabled={converting}>
          <legend>Output</legend>
          {modes.map((m) => (
            <label key={m.id} className="converter-mode">
              <input
                type="radio"
                name={`${id}-mode`}
                value={m.id}
                checked={activeMode === m.id}
                onChange={() => {
                  setMode(m.id)
                  reset()
                }}
              />
              <span>
                <strong>{m.label}</strong>
                <span className="muted">{m.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {settings.length > 0 && (
        <fieldset className="converter-modes" disabled={converting}>
          <legend>Output</legend>
          {settings.includes('quality') && (
            <label className="converter-setting">
              <span>
                <strong>Quality</strong>
                <span className="muted">Lower values make smaller files with more visible compression.</span>
              </span>
              <span className="converter-setting-control">
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={quality}
                  onChange={(e) => {
                    setQuality(Number(e.target.value))
                    reset()
                  }}
                />
                <output>{quality}</output>
              </span>
            </label>
          )}
          {settings.includes('background') && (
            <label className="converter-setting">
              <span>
                <strong>Background</strong>
                <span className="muted">{to.label} has no transparency, so transparent areas are filled with this color.</span>
              </span>
              <span className="converter-setting-control">
                <input
                  type="color"
                  value={background}
                  onChange={(e) => {
                    setBackground(e.target.value)
                    reset()
                  }}
                />
              </span>
            </label>
          )}
        </fieldset>
      )}

      <label
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept={from.accept}
          disabled={converting}
          onChange={(e) => {
            chooseFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {file ? (
          <span>
            <strong>{file.name}</strong> <span className="muted">({formatSize(file.size)}). Click to choose another.</span>
          </span>
        ) : (
          <span>
            Drop a {from.label} here, or <span className="link">choose a file</span>
          </span>
        )}
      </label>

      <div className="converter-actions">
        <button type="button" className="button" disabled={!file || !conversion || converting} onClick={convert}>
          {converting ? 'Converting…' : `Convert to ${to.label}`}
        </button>

        {status.state === 'converting' && status.total > 0 && (
          <span className="muted">
            Page {Math.min(status.done + 1, status.total)} of {status.total}
          </span>
        )}
        {status.state === 'done' && (
          <a className="button secondary" href={status.url} download={status.filename}>
            Download {status.filename}
          </a>
        )}
      </div>

      {status.state === 'error' && (
        <p className="error" role="alert">
          {status.message}
        </p>
      )}
    </section>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
