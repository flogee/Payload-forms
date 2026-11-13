'use client'

// Adapted from ReUI chart primitives, MIT, Copyright (c) 2025 Keenthemes Inc.
// Source revision and complete license: THIRD_PARTY_NOTICES.md / third_party/reui-LICENSE.txt.
import { createContext, useContext, useId, type CSSProperties, type ComponentProps, type ReactNode } from 'react'
import { ResponsiveContainer, Tooltip, type DefaultTooltipContentProps, type TooltipValueType } from 'recharts'

export type ChartConfig = Record<string, { label: ReactNode; color: string }>
const ChartContext = createContext<ChartConfig>({})

/** ReUI's configurable chart frame, adapted to Forms CSS without style injection. */
export function ChartContainer({ config, children, className = '', style, ...props }: ComponentProps<'div'> & {
  config: ChartConfig; children: ComponentProps<typeof ResponsiveContainer>['children']
}) {
  const id = useId().replace(/[^a-z0-9_-]/gi, '')
  const colors = Object.fromEntries(Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color]))
  return <ChartContext.Provider value={config}>
    <div className={`report-chart ${className}`} data-chart={`report-${id}`} style={{ ...colors, ...style } as CSSProperties} {...props}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 160 }}>{children}</ResponsiveContainer>
    </div>
  </ChartContext.Provider>
}

export const ChartTooltip = Tooltip

export function ChartTooltipContent({ active, payload }: Partial<DefaultTooltipContentProps<TooltipValueType, number | string>> & { active?: boolean }) {
  const config = useContext(ChartContext)
  if (!active || !payload?.length) return null
  return <div className="report-chart-tooltip">{payload.filter(item => item.type !== 'none').map((item, index) => {
    const key = String(item.dataKey ?? item.name ?? ''), entry = config[key]
    return <div key={index}><span className="report-swatch" style={{ background: entry?.color ?? item.color }} aria-hidden="true" />
      <span>{entry?.label ?? String(item.name ?? '')}</span><strong>{typeof item.value === 'number' ? `${item.value.toLocaleString('de-AT', { maximumFractionDigits: 1 })} %` : String(item.value ?? '')}</strong>
    </div>
  })}</div>
}

export function ChartLegendContent({ config }: { config: ChartConfig }) {
  return <ul className="report-chart-legend">{Object.entries(config).map(([key, item]) => <li key={key}>
    <span className="report-swatch" style={{ background: item.color }} aria-hidden="true" />{item.label}
  </li>)}</ul>
}
