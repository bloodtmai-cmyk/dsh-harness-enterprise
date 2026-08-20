// DetailsPanel: close button + the selected call's args and
// result — args as JSON, the result raw except for a terminal-card call, whose
// Output section is the command's terminal card. Reads the
// selection from the shared chat
// store (conversation writes, this panel reads — the cross-registration
// share the store seat exists for) and derives the call material from the
// session snapshot — no data of its own.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { CodeBlock, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, RunningToolCall, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { DetailsSlotProps } from '../contract/slots.ts'
import { findToolCall } from '../chat/tool-node-reader.ts'
import {
  DESKTOP_DETAILS_EVENT,
  DESKTOP_PREVIEW_EVENT,
  DesktopFilePreview,
  isDesktopPreviewAvailable,
} from './DesktopFilePreview.tsx'
import type { DesktopPreviewRequest } from './DesktopFilePreview.tsx'
import css from './DetailsPanel.module.css'

/** Full props composed by reference from the contract (automatic shares & injected share). */
export type DetailsPanelProps = DetailsSlotProps

/**
 * Selected call material: the call's display name and args plus the frozen
 * block slice it came from. `block` is a snapshot-cached reference, so the
 * wrapper stays shallow-equal across unrelated snapshot frames; the settled /
 * running split is read off it with the `'kind' in block` discrimination
 * instead of duplicated as flags.
 */
interface CallMaterial {
  name: string
  argsRaw: string | null
  block: ToolCallBlock
}

/** Material of a settled result node (native call or run_code sub-dispatch). */
function settledMaterial(node: ToolResultNode, callId: string): CallMaterial {
  return { name: node.call?.name ?? callId, argsRaw: node.call?.argsRaw ?? null, block: node }
}

/** Material of an in-flight call (native call or run_code sub-dispatch). */
function runningMaterial(call: RunningToolCall): CallMaterial {
  return { name: call.name, argsRaw: call.argsRaw, block: call }
}

function materialFor(s: ConversationSnapshot, callId: string): CallMaterial | null {
  const found = findToolCall(s, callId)
  if (found === undefined) return null
  return 'kind' in found ? settledMaterial(found, callId) : runningMaterial(found)
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // Not JSON (streaming fragment or plain text): show verbatim.
    return raw
  }
}

/** Flatten a settled result for the no-ui-tool fallback. */
function rawResultText(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}

export function DetailsPanel({ useSession, useSessions, sessionId, useStore, renderSlot, closeDetails, t }: DetailsPanelProps) {
  const selection = useStore(s => s.selection)
  // Session workspace root: an omitted or relative terminal cwd resolves
  // against it, which the pure presenter cannot see.
  const sessionCwd = useSessions(list => list.byId[sessionId]?.cwd)
  const callId = selection?.callId
  // materialFor builds a fresh wrapper; shallowEqual short-circuits on its
  // stable members (result node reference rides the snapshot's structural sharing).
  const material = useSession(
    s => (callId === undefined ? null : materialFor(s, callId)),
    (a, b) => shallowEqual(a, b))
  const previewAvailable = isDesktopPreviewAvailable()
  const [activePane, setActivePane] = useState<string>('details')
  const [extensionPaneTitle, setExtensionPaneTitle] = useState<string | null>(null)
  const [previewRequest, setPreviewRequest] = useState<DesktopPreviewRequest | null>(null)
  const previewLabels = useMemo(() => ({
    empty: t('details.preview.empty'),
    loading: t('details.preview.loading'),
    refresh: t('details.preview.refresh'),
    openExternal: t('details.preview.openExternal'),
    errors: {
      'invalid-request': t('details.preview.invalid'),
      'outside-workspace': t('details.preview.outsideWorkspace'),
      'not-file': t('details.preview.notFile'),
      'unsupported': t('details.preview.unsupported'),
      'too-large': t('details.preview.tooLarge'),
      'unavailable': t('details.preview.unavailable'),
    },
  }), [t])

  useEffect(() => {
    if (!previewAvailable) return
    const openPreview = (event: Event): void => {
      const request = (event as CustomEvent<DesktopPreviewRequest>).detail
      setPreviewRequest(request)
      setExtensionPaneTitle(null)
      setActivePane('preview')
    }
    const openDetails = (): void => {
      setExtensionPaneTitle(null)
      setActivePane('details')
    }
    window.addEventListener(DESKTOP_PREVIEW_EVENT, openPreview)
    window.addEventListener(DESKTOP_DETAILS_EVENT, openDetails)
    return () => {
      window.removeEventListener(DESKTOP_PREVIEW_EVENT, openPreview)
      window.removeEventListener(DESKTOP_DETAILS_EVENT, openDetails)
    }
  }, [previewAvailable])

  const previewName = previewRequest?.path.split(/[\\/]/).at(-1)
  const selectPane = useCallback((pane: string, title?: string) => {
    setExtensionPaneTitle(title?.trim() || null)
    setActivePane(pane)
  }, [])
  const extensionTabs = renderSlot('conversation.details.tabs', { activePane, selectPane })
  const hasExtensionTabs = extensionTabs !== null && extensionTabs !== undefined && extensionTabs !== false
  const title = activePane === 'preview'
    ? previewName ?? t('details.preview.tab')
    : activePane !== 'details'
      ? extensionPaneTitle ?? activePane
      : selection === null ? t('details.title') : material?.name ?? selection.toolName ?? t('details.title')

  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.title}>{title}</div>
        <button
          type="button" className={css.close} aria-label={t('details.close')}
          onClick={() => { closeDetails() }}
        >
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      {(previewAvailable || hasExtensionTabs) && (
        <div className={css.tabs} role="tablist" aria-label={t('details.panelTabs')}>
          <button
            type="button"
            role="tab"
            aria-selected={activePane === 'details'}
            data-active={activePane === 'details' || undefined}
            onClick={() => {
              setExtensionPaneTitle(null)
              setActivePane('details')
            }}
          >
            {t('details.tab')}
          </button>
          {previewAvailable && (
            <button
              type="button"
              role="tab"
              aria-selected={activePane === 'preview'}
              data-active={activePane === 'preview' || undefined}
              onClick={() => {
                setExtensionPaneTitle(null)
                setActivePane('preview')
              }}
            >
              {t('details.preview.tab')}
            </button>
          )}
          {extensionTabs}
        </div>
      )}
      {activePane === 'preview' && previewAvailable
        ? <DesktopFilePreview request={previewRequest} labels={previewLabels} />
        : activePane === 'details'
          ? (
            <div className={css.body}>
              {selection === null || callId === undefined
                ? <div className={css.empty}>{t('details.empty')}</div>
                : material === null
                  ? <div className={css.empty}>{t('details.notInWindow')}</div>
                  : (
                    <>
                      {material.argsRaw !== null && (
                        <section className={css.section}>
                          <div className={css.sectionLabel}>{t('details.input')}</div>
                          <CodeBlock code={pretty(material.argsRaw)} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />
                        </section>
                      )}
                      <section className={css.section}>
                        <div className={css.sectionLabel}>{t('details.output')}</div>
                        {/* Keyed by the selected call: the body owns per-call view
                          state (the terminal card's expand and copy), which React
                          would otherwise carry into the next selection because the
                          panel does not unmount between calls. */}
                        <Fragment key={callId}>
                          {renderSlot('conversation.details.tool', { block: material.block, cwd: sessionCwd }, {
                            fallback: 'kind' in material.block
                              ? (
                                <pre className={css.code} data-error={material.block.isError || undefined}>
                                  {rawResultText(material.block)}
                                </pre>
                              )
                              : <div className={css.empty}>{t('details.running')}</div>,
                          })}
                        </Fragment>
                      </section>
                    </>
                  )}
            </div>
          )
          : renderSlot('conversation.details.panel', { activePane }, {
            entryKey: activePane,
            fallback: <div className={css.body}><div className={css.empty}>{t('details.empty')}</div></div>,
          })}
    </div>
  )
}
