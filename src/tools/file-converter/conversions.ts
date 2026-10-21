export interface Format {
  id: string
  /** Shown after "I have a" / "I want a". */
  label: string
  extension: string
  /** Value for the file input's `accept` attribute. */
  accept: string
}

export interface ConvertOptions {
  /** Id of the chosen mode, when the conversion offers more than one. */
  mode?: string
  onProgress?: (done: number, total: number) => void
}

export interface ConversionMode {
  id: string
  label: string
  description: string
}

export interface Conversion {
  from: Format
  to: Format
  modes?: ConversionMode[]
  convert: (file: File, options: ConvertOptions) => Promise<Blob>
}

export const formats = {
  pdf: { id: 'pdf', label: 'PDF', extension: 'pdf', accept: '.pdf,application/pdf' },
  docx: {
    id: 'docx',
    label: 'DOCX',
    extension: 'docx',
    accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  txt: { id: 'txt', label: 'Text File', extension: 'txt', accept: '.txt,text/plain' },
} satisfies Record<string, Format>

// Converters are imported on demand so their libraries only download when a conversion runs.
export const conversions: Conversion[] = [
  {
    from: formats.pdf,
    to: formats.docx,
    modes: [
      {
        id: 'editable',
        label: 'Editable text',
        description:
          'Rebuilds the text as Word paragraphs, keeping font sizes, bold and italic where possible. Images, tables and multi-column layouts are simplified.',
      },
      {
        id: 'exact',
        label: 'Exact layout',
        description: 'Each page becomes a full-page image, so it looks exactly like the PDF, but the text is not editable.',
      },
    ],
    convert: async (file, options) => (await import('./pdfToDocx')).pdfToDocx(file, options),
  },
  {
    from: formats.pdf,
    to: formats.txt,
    convert: async (file, options) => (await import('./pdfToTxt')).pdfToTxt(file, options),
  },
]

export const sourceFormats: Format[] = [...new Set(conversions.map((c) => c.from))]

export function targetsFor(from: Format): Format[] {
  return conversions.filter((c) => c.from.id === from.id).map((c) => c.to)
}

export function findConversion(from: Format, to: Format): Conversion | undefined {
  return conversions.find((c) => c.from.id === from.id && c.to.id === to.id)
}
