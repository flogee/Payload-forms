'use client'

import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import type { AnalysisOption, AnalysisSeries } from '@/survey/analysis-types'
import { ChartContainer, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from './Chart'

export const reportNumber = (n: number) => n.toLocaleString('de-AT', { maximumFractionDigits: 1 })
const colors = ['#a65d42', '#ca987a', '#dce2dd', '#75a89b', '#28665c']

export function FrequencyChart({ options, base, caption }: { options: AnalysisOption[]; base: number; caption: string }) {
  if (!base) return <p className="report-empty-inline">Noch keine beantworteten Angaben.</p>
  return <figure className="report-frequency" aria-label={caption}>
    <figcaption className="report-sr-only">{caption}</figcaption>
    <ul>{options.map(option => <li key={option.value}>
      <div className="report-frequency__label"><span>{option.label}</span><strong>{reportNumber(option.count)} <span>· {reportNumber(option.percent)} %</span></strong></div>
      <div className="report-frequency__track" aria-hidden="true"><span style={{ width: `${option.percent}%` }} /></div>
    </li>)}</ul>
  </figure>
}

export function isFiveLevelMatrix(series: AnalysisSeries[]) {
  return series.length > 0 && series.every(row => row.kind === 'matrix' && ['1', '2', '3', '4', '5'].every(code => row.options.some(option => option.value === code))
    && row.options.every(option => ['1', '2', '3', '4', '5', 'unknown'].includes(option.value)))
}

export function MatrixOverview({ series, questionLabel }: { series: AnalysisSeries[]; questionLabel: string }) {
  const config: ChartConfig = Object.fromEntries(['1', '2', '3', '4', '5'].map((value, index) => [`s${value}`, {
    label: series[0].options.find(option => option.value === value)!.label, color: colors[index],
  }]))
  return <div className="report-matrix">
    <ChartLegendContent config={config} />
    <p className="report-caption">Verteilung der fünf Bewertungsstufen. „Kann ich nicht beurteilen“ steht separat und zählt nicht als Bewertung.</p>
    {series.map(row => {
      const numeric = ['1', '2', '3', '4', '5'].map(code => row.options.find(option => option.value === code)!)
      const rated = numeric.reduce((sum, option) => sum + option.count, 0)
      const unknown = row.options.find(option => option.value === 'unknown')?.count ?? 0
      const chartData = [Object.fromEntries(numeric.map(option => [`s${option.value}`, rated ? option.count / rated * 100 : 0]))]
      const label = row.label.startsWith(`${questionLabel} · `) ? row.label.slice(questionLabel.length + 3) : row.label
      return <div className="report-matrix__row" key={row.id}>
        <p className="report-matrix__label">{label}</p>
        <div className="report-matrix__visual">
          {rated ? <>
            <div className="report-screen-chart"><ChartContainer config={config} style={{ height: 30 }} aria-label={`${label}: ${rated} Bewertungen`} role="group">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, bottom: 0, left: 0, right: 0 }} accessibilityLayer>
                <XAxis type="number" domain={[0, 100]} hide /><YAxis type="category" hide />
                <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
                {Object.entries(config).map(([key, item]) => <Bar key={key} dataKey={key} name={key} stackId="scale" fill={item.color} isAnimationActive={false} />)}
              </BarChart>
            </ChartContainer></div>
            <div className="report-print-stack" aria-hidden="true">{numeric.map(option => <span key={option.value} style={{ width: `${option.count / rated * 100}%`, background: config[`s${option.value}`].color }} />)}</div>
          </> : <p className="report-empty-inline">Keine Bewertung</p>}
          <p className="report-matrix__counts"><span>{rated} bewertet</span><span>{unknown} nicht beurteilbar</span><span>{row.missing} ohne Angabe</span>{row.notAsked > 0 && <span>{row.notAsked} nicht gefragt</span>}</p>
        </div>
      </div>
    })}
    <details className="report-data" data-report-expand><summary>Genaue Werte je Aussage</summary>
      <div className="report-table-scroll"><table><caption>Bewertungen und fehlende Angaben</caption><thead><tr><th scope="col">Aussage</th>{Object.entries(config).map(([key, value]) => <th scope="col" key={key}>{value.label}</th>)}<th scope="col">Nicht beurteilbar</th><th scope="col">Ohne Angabe</th></tr></thead>
        <tbody>{series.map(row => <tr key={row.id}><th scope="row">{row.label.startsWith(`${questionLabel} · `) ? row.label.slice(questionLabel.length + 3) : row.label}</th>
          {['1', '2', '3', '4', '5', 'unknown'].map(code => <td key={code}>{row.options.find(option => option.value === code)?.count ?? 0}</td>)}<td>{row.missing}</td></tr>)}</tbody>
      </table></div>
    </details>
  </div>
}
