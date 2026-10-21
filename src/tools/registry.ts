import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export interface Tool {
  /** URL segment, e.g. `file-converter` → `/#/file-converter` */
  path: string
  name: string
  description: string
  /** Lazy-loaded so heavy dependencies (e.g. WASM codecs) only download when the tool is opened. */
  component: LazyExoticComponent<ComponentType>
}

export const tools: Tool[] = [
  {
    path: 'file-converter',
    name: 'File Converter',
    description: 'Convert between video and document formats (MKV, MOV, MP4, PDF, DOC, HTML…) in your browser.',
    component: lazy(() => import('./file-converter/FileConverter')),
  },
  {
    path: 'text-encoding',
    name: 'Text Encoding',
    description: 'Encode and decode text, such as plain text ↔ Base64.',
    component: lazy(() => import('./text-encoding/TextEncoding')),
  },
]
