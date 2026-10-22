import { formatJson } from './json'
import type { FormatOptions, FormatResult } from './format'

export interface Language {
  id: string
  name: string
  placeholder: string
  format: (input: string, options: FormatOptions) => FormatResult
}

export const languages: Language[] = [
  {
    id: 'json',
    name: 'JSON',
    placeholder: 'Paste JSON to validate and format it…',
    format: formatJson,
  },
]

export const indents = [
  { id: '2', label: '2 spaces', value: '  ' },
  { id: '4', label: '4 spaces', value: '    ' },
  { id: 'tab', label: 'Tab', value: '\t' },
] as const
