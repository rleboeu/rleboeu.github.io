import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export interface Tool {
  /** URL segment, e.g. `file-converter` → `/#/file-converter` */
  path: string
  name: string
  description: string
  /**
   * Hidden search keywords: never rendered, only matched by the header search.
   * Include synonyms, formats, file extensions and phrases people would type to find the tool.
   */
  tags: string[]
  /** Lazy-loaded so heavy dependencies (e.g. WASM codecs) only download when the tool is opened. */
  component: LazyExoticComponent<ComponentType>
}

export const tools: Tool[] = [
  {
    path: 'file-converter',
    name: 'File Converter',
    description: 'Convert PDFs to Word (DOCX) or plain text, and images between JPG, PNG and WEBP, in your browser.',
    tags: [
      'convert',
      'converter',
      'conversion',
      'file',
      'format',
      'change format',
      'save as',
      'export',
      'transform',
      'document',
      'pdf',
      'docx',
      'doc',
      'word',
      'microsoft word',
      'txt',
      'text',
      'plain text',
      'extract text',
      'pdf to word',
      'pdf to docx',
      'pdf to text',
      'table',
      'tables',
      'pdf table to word',
      'editable word',
      'image',
      'picture',
      'photo',
      'jpg',
      'jpeg',
      'png',
      'webp',
      'jpg to png',
      'png to jpg',
      'webp to png',
      'webp to jpg',
      'remove transparency',
    ],
    component: lazy(() => import('./file-converter/FileConverter')),
  },
  {
    path: 'text-encoding',
    name: 'Text Encoding',
    description: 'Encode and decode text, such as plain text ↔ Base64.',
    tags: [
      'encode',
      'decode',
      'encoding',
      'decoding',
      'encoder',
      'decoder',
      'base64',
      'base 64',
      'b64',
      'text',
      'string',
      'plain text',
      'convert',
      'text to base64',
      'base64 to text',
    ],
    component: lazy(() => import('./text-encoding/TextEncoding')),
  },
]
