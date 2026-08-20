import type { SearchBlockLabels, WebBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** Localized labels for search cards rendered inside conversation surfaces. */
export function searchBlockLabels(t: TranslateNS<'conversation'>): SearchBlockLabels {
  return {
    copy: t('copy'),
    copied: t('copied'),
    empty: t('search.empty'),
    collapse: t('collapse'),
    collapseAria: t('search.collapseResults'),
    expandAria: count => t('search.expandResults', { count }),
    expandRest: count => t('search.rest', { count }),
    shown: (shown, total) => t('search.summary.shown', { shown, total }),
    paths: count => t('search.summary.paths', { count }),
    matches: (count, files) => t('search.summary.matches', { count, files }),
  }
}

/** Localized labels for web retrieval cards rendered inside conversation surfaces. */
export function webBlockLabels(t: TranslateNS<'conversation'>): WebBlockLabels {
  return {
    empty: t('web.empty'),
    sourcesTruncated: t('web.sourcesTruncated'),
    contentTruncated: t('web.contentTruncated'),
  }
}
