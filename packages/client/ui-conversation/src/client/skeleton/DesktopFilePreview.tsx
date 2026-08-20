import { useCallback, useEffect, useState } from 'react'
import {
  IconFolderOpenOutline16,
  IconRefreshOutline14,
  MarkdownText,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DesktopFilePreview.module.css'

export const DESKTOP_PREVIEW_EVENT = 'dsh:desktop-preview-open'
export const DESKTOP_DETAILS_EVENT = 'dsh:desktop-details-open'

const PREVIEW_EXTENSIONS = new RegExp(
  '\\.(?:css|csv|gif|go|htm|html|java|jpe?g|js|json|jsx|log|md|markdown|mdx|pdf|png|py|rs|scss|sh|sql|svg|'
  + 'toml|ts|tsx|txt|webp|xml|ya?ml)$',
  'i',
)

export interface DesktopPreviewRequest {
  path: string
  workspaceRoot: string
}

type DesktopPreviewFile = {
  name: string
  displayPath: string
  mime: string
} & (
  | { kind: 'html'; content: string }
  | { kind: 'markdown'; content: string }
  | { kind: 'text'; content: string }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'pdf'; dataUrl: string }
)

interface DesktopPreviewResult {
  ok: boolean
  code?: string
  file?: DesktopPreviewFile
}

interface DesktopPreviewBridge {
  readFile: (request: DesktopPreviewRequest) => Promise<DesktopPreviewResult>
  openExternal: (request: DesktopPreviewRequest) => Promise<{ ok: boolean; code?: string }>
}

declare global {
  interface Window {
    desktopPreview?: DesktopPreviewBridge
  }
}

export function isDesktopPreviewAvailable(): boolean {
  return typeof window !== 'undefined' && window.desktopPreview !== undefined
}

export function isDesktopPreviewPath(path: string): boolean {
  return PREVIEW_EXTENSIONS.test(path)
}

export function requestDesktopFilePreview(request: DesktopPreviewRequest): boolean {
  if (!isDesktopPreviewAvailable() || !isDesktopPreviewPath(request.path)) return false
  window.dispatchEvent(new CustomEvent<DesktopPreviewRequest>(DESKTOP_PREVIEW_EVENT, { detail: request }))
  return true
}

export function requestDesktopDetailsPane(): void {
  if (!isDesktopPreviewAvailable()) return
  window.dispatchEvent(new Event(DESKTOP_DETAILS_EVENT))
}

export interface DesktopFilePreviewLabels {
  empty: string
  loading: string
  refresh: string
  openExternal: string
  errors: Record<string, string> & { unavailable: string }
}

export interface DesktopFilePreviewProps {
  request: DesktopPreviewRequest | null
  labels: DesktopFilePreviewLabels
}

function PreviewBody({ file }: { file: DesktopPreviewFile }) {
  if (file.kind === 'html') {
    return (
      <iframe
        className={css.frame}
        srcDoc={file.content}
        title={file.name}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    )
  }
  if (file.kind === 'markdown') {
    return <div className={css.markdown}><MarkdownText text={file.content} /></div>
  }
  if (file.kind === 'text') return <pre className={css.text}>{file.content}</pre>
  if (file.kind === 'image') {
    return <div className={css.imageStage}><img src={file.dataUrl} alt={file.name} /></div>
  }
  return <embed className={css.frame} src={file.dataUrl} type="application/pdf" title={file.name} />
}

export function DesktopFilePreview({ request, labels }: DesktopFilePreviewProps) {
  const [file, setFile] = useState<DesktopPreviewFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (request === null || window.desktopPreview === undefined) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.desktopPreview.readFile(request)
      if (!result.ok || result.file === undefined) {
        setFile(null)
        setError(labels.errors[result.code ?? 'unavailable'] ?? labels.errors.unavailable)
        return
      }
      setFile(result.file)
    } catch {
      setFile(null)
      setError(labels.errors.unavailable)
    } finally {
      setLoading(false)
    }
  }, [labels, request])

  useEffect(() => { void load() }, [load])

  if (request === null) return <div className={css.empty}>{labels.empty}</div>
  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <div className={css.path} title={file?.displayPath ?? request.path}>
          {file?.displayPath ?? request.path}
        </div>
        <Tooltip label={labels.refresh} side="bottom" delayMs={400}>
          <button type="button" aria-label={labels.refresh} onClick={() => { void load() }}>
            <IconRefreshOutline14 />
          </button>
        </Tooltip>
        <Tooltip label={labels.openExternal} side="bottom" delayMs={400}>
          <button
            type="button"
            aria-label={labels.openExternal}
            onClick={() => { void window.desktopPreview?.openExternal(request) }}
          >
            <IconFolderOpenOutline16 />
          </button>
        </Tooltip>
      </div>
      <div className={css.content}>
        {loading
          ? <div className={css.empty}>{labels.loading}</div>
          : error !== null
            ? <div className={css.empty} role="alert">{error}</div>
            : file === null
              ? <div className={css.empty}>{labels.empty}</div>
              : <PreviewBody file={file} />}
      </div>
    </div>
  )
}
