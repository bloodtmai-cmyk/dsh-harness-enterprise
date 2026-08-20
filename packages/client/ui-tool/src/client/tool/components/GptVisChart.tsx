import { useEffect, useRef, useState } from 'react'
import type { GPTVis as GPTVisInstance } from '@antv/gpt-vis/dist/esm/index.js'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GptVisChart.module.css'

type ChartBlock = Extract<ToolResultNode['content'][number], { type: 'chart' }>

export interface GptVisChartProps {
  chart: ChartBlock
  t: TranslateNS<'conversation'>
}

function chartTheme(value: unknown): 'default' | 'light' | 'dark' | 'academy' | undefined {
  return value === 'default' || value === 'light' || value === 'dark' || value === 'academy'
    ? value
    : undefined
}

/** Render a bounded MCP chart configuration without accepting markup or script. */
export function GptVisChart({ chart, t }: GptVisChartProps) {
  const root = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const container = root.current
    if (container === null) return
    let visualization: GPTVisInstance | undefined
    let createVisualization: typeof import('@antv/gpt-vis/dist/esm/index.js')['GPTVis'] | undefined
    let observer: ResizeObserver | undefined
    let disposed = false
    let scheduled = 0
    const render = (): void => {
      const Visualization = createVisualization
      if (Visualization === undefined || disposed) return
      cancelAnimationFrame(scheduled)
      scheduled = requestAnimationFrame(() => {
        try {
          visualization?.destroy()
          container.replaceChildren()
          const width = Math.max(280, Math.floor(container.getBoundingClientRect().width || 640))
          const theme = chartTheme(chart.payload.theme)
          visualization = new Visualization({
            container,
            width,
            height: 360,
            wrapper: false,
            locale: 'zh-CN',
            ...theme === undefined ? {} : { theme },
          })
          visualization.render(chart.payload)
          setFailed(false)
        } catch {
          setFailed(true)
        }
      })
    }
    void import('@antv/gpt-vis/dist/esm/index.js').then(({ GPTVis }) => {
      if (disposed) return
      createVisualization = GPTVis
      render()
      observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(render)
      observer?.observe(container)
    }, () => { if (!disposed) setFailed(true) })
    return () => {
      disposed = true
      observer?.disconnect()
      cancelAnimationFrame(scheduled)
      visualization?.destroy()
    }
  }, [chart])

  return (
    <div className={css.frame} data-chart-type={chart.chartType}>
      <div ref={root} className={css.canvas} aria-label={t('chart.label')} />
      {failed ? <div className={css.error} role="status">{t('chart.renderFailed')}</div> : null}
    </div>
  )
}
