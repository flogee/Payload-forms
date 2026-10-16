'use client'

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnalysisSeries } from '@/survey/analysis-types'

const percent = (value: number) => `${new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(value)} %`

export function AnalysisChart({ series }: { series: AnalysisSeries }) {
  if (series.display === 'completion' || !series.options.length || !series.answered) return null
  return (
    <div className="analysis-chart" role="group" aria-label={`${series.label}: Anteile unter ${series.answered} beantworteten Einsendungen. Vollständige Angaben in der folgenden Tabelle.`}>
      <ResponsiveContainer width="100%" height={Math.max(150, series.options.length * 42 + 36)} minWidth={0}>
        <BarChart data={series.options} layout="vertical" accessibilityLayer margin={{ top: 4, right: 24, bottom: 4, left: 0 }}>
          <XAxis type="number" domain={[0, 100]} tickFormatter={percent} tick={{ fill: '#60716d', fontSize: 11 }} axisLine={false} tickLine={false} ticks={[0, 50, 100]} />
          <YAxis type="category" dataKey="label" width={125} tickFormatter={(label: string) => label.length > 21 ? `${label.slice(0, 20)}…` : label} tick={{ fill: '#193b39', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value) => percent(Number(value))} cursor={{ fill: '#edf2eb' }} contentStyle={{ background: '#faf9f5', border: '1px solid #dce3dc', borderRadius: 5, maxWidth: 260, whiteSpace: 'normal' }} />
          <Bar dataKey="percent" name="Anteil" fill="#28665c" radius={[0, 3, 3, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
