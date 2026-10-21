import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import type { Tool } from '../tools/registry'
import { searchTools } from '../tools/search'

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

export default function ToolSearch() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const results = searchTools(query)
  const active = Math.min(activeIndex, results.length - 1)

  // "/" or Ctrl/⌘+K focuses the search from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const shortcut = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)
      if (shortcut || (event.key === '/' && !isTypingTarget(event.target))) {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function choose(tool: Tool) {
    navigate(`/${tool.path}`)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setOpen(true)
        setActiveIndex(results.length ? (active + 1) % results.length : 0)
        break
      case 'ArrowUp':
        event.preventDefault()
        setOpen(true)
        setActiveIndex(results.length ? (active - 1 + results.length) % results.length : 0)
        break
      case 'Enter':
        if (open && results[active]) {
          event.preventDefault()
          choose(results[active])
        }
        break
      case 'Escape':
        if (open) setOpen(false)
        else {
          setQuery('')
          inputRef.current?.blur()
        }
        break
    }
  }

  const expanded = open && results.length > 0
  const optionId = (index: number) => `${listId}-option-${index}`

  return (
    <div className="search">
      <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        placeholder="Search utilities…"
        aria-label="Search utilities"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {!query && (
        <kbd className="search-hint" aria-hidden="true">
          /
        </kbd>
      )}
      {open && (
        <div className="search-popover">
          {/* Keep focus in the input while clicking a result, so blur doesn't close the list first. */}
          <ul id={listId} role="listbox" aria-label="Utilities" onMouseDown={(event) => event.preventDefault()}>
            {results.map((tool, index) => (
              <li
                key={tool.path}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className="search-option"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(tool)}
              >
                <span className="search-option-name">{tool.name}</span>
                <span className="search-option-description">{tool.description}</span>
              </li>
            ))}
          </ul>
          {results.length === 0 && <p className="search-empty">No utilities match “{query.trim()}”.</p>}
        </div>
      )}
    </div>
  )
}
