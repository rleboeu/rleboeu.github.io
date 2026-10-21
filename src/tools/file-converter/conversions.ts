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
  /** Encoding quality from 1 to 100, for conversions with the `quality` setting. */
  quality?: number
  /** CSS color painted behind transparent areas, for conversions with the `background` setting. */
  background?: string
  onProgress?: (done: number, total: number) => void
}

/** Extra controls a conversion shows: a quality slider and/or a background color for transparency. */
export type ConversionSetting = 'quality' | 'background'

export interface ConversionMode {
  id: string
  label: string
  description: string
}

export interface Conversion {
  from: Format
  to: Format
  modes?: ConversionMode[]
  settings?: ConversionSetting[]
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
  jpg: { id: 'jpg', label: 'JPG', extension: 'jpg', accept: '.jpg,.jpeg,image/jpeg' },
  png: { id: 'png', label: 'PNG', extension: 'png', accept: '.png,image/png' },
  webp: { id: 'webp', label: 'WEBP', extension: 'webp', accept: '.webp,image/webp' },
} satisfies Record<string, Format>

const imageFormats = [
  { format: formats.jpg, type: 'image/jpeg', lossy: true, transparent: false },
  { format: formats.png, type: 'image/png', lossy: false, transparent: true },
  { format: formats.webp, type: 'image/webp', lossy: true, transparent: true },
]

// Every image format converts to every other one.
const imageConversions: Conversion[] = imageFormats.flatMap((from) =>
  imageFormats
    .filter((to) => to !== from)
    .map((to) => ({
      from: from.format,
      to: to.format,
      settings: [
        ...(to.lossy ? ['quality' as const] : []),
        ...(from.transparent && !to.transparent ? ['background' as const] : []),
      ],
      convert: async (file: File, options: ConvertOptions) =>
        (await import('./convertImage')).convertImage(file, to.type, options),
    })),
)

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
  ...imageConversions,
]

export const sourceFormats: Format[] = [...new Set(conversions.map((c) => c.from))]

export function targetsFor(from: Format): Format[] {
  return conversions.filter((c) => c.from.id === from.id).map((c) => c.to)
}

export function findConversion(from: Format, to: Format): Conversion | undefined {
  return conversions.find((c) => c.from.id === from.id && c.to.id === to.id)
}
