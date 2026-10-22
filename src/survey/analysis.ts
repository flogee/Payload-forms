import type { Answers, Definition, Question, Ranking } from './types'
import type { AnalysisOption, AnalysisReport, AnalysisSeries, SharedAnalysisReport, SharedAnalysisSeries } from './analysis-types'
import { answerSchema, hasAnswer, visible } from './validation'
import { ratingLabels, sliderSettings } from './voting'

export const ANALYSIS_LIMIT = 1000
export const MINIMUM_GROUP = 5
export type AnalysisRecord = { answers: Answers; createdAt?: string; testOnly?: boolean }
const percent = (count: number, answered: number) => answered ? Math.round(count / answered * 1000) / 10 : 0
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function series(q: Question, values: unknown[], total: number, row?: { key: string; label: string }): AnalysisSeries {
  let answered = 0
  let options: AnalysisOption[] = []
  const numericDistribution = ['slider', 'stars', 'smiley'].includes(q.kind)
  const distribution = ['single', 'multiple', 'matrix'].includes(q.kind) || numericDistribution
  const countStatus = q.kind === 'count' || q.kind === 'counts'
  if (numericDistribution) {
    const labels = q.kind === 'slider' ? [] : ratingLabels(q)
    const { min, max, step } = q.kind === 'slider' ? sliderSettings(q) : { min: 1, max: 5, step: 1 }
    options = Array.from({ length: (max - min) / step + 1 }, (_, i) => {
      const value = min + i * step
      return { value: String(value), label: q.kind === 'slider' ? String(value) : `${value} · ${labels[i]}`, count: 0, percent: 0 }
    })
    const schema = answerSchema(q)
    for (const value of values) {
      const parsed = schema.safeParse(value)
      if (!parsed.success) continue
      const option = options.find(o => o.value === String(parsed.data))
      if (!option) continue
      option.count++; answered++
    }
  } else if (distribution) {
    options = (q.options ?? []).map(o => ({ value: o.value, label: o.label, count: 0, percent: 0 }))
    const codes = new Set(options.map(o => o.value))
    for (const value of values) {
      const choice = typeof value === 'string' ? value : object(value).choice
      const selected = [...new Set((Array.isArray(choice) ? choice : [choice]).filter((code): code is string => typeof code === 'string' && codes.has(code)))]
      // Stored submissions are validated; reject malformed single/matrix choices defensively.
      if (!selected.length || (q.kind !== 'multiple' && selected.length !== 1)) continue
      answered++
      for (const option of options) if (selected.includes(option.value)) option.count++
    }
  } else if (countStatus) {
    options = [{ value: 'value', label: 'Zahlenangabe', count: 0, percent: 0 }, { value: 'unknown', label: 'Weiß nicht', count: 0, percent: 0 },
      ...(q.allowNA ? [{ value: 'na', label: 'Nicht zutreffend', count: 0, percent: 0 }] : [])]
    for (const value of values) {
      const entry = object(value), option = options.find(o => o.value === entry.status)
      if (!option || (entry.status === 'value' && (typeof entry.value !== 'number' || !Number.isInteger(entry.value)))) continue
      option.count++; answered++
    }
  } else answered = values.filter(hasAnswer).length
  return {
    id: row ? `${q.id}:${row.key}` : q.id, questionID: q.id, ...(row ? { rowID: row.key } : {}), block: q.block,
    label: row ? `${q.label} · ${row.label}` : q.label, kind: q.kind,
    display: distribution ? 'distribution' : countStatus ? 'count-status' : 'completion',
    eligible: values.length, answered, missing: values.length - answered, notAsked: total - values.length,
    multipleChoice: q.kind === 'multiple', options: options.map(o => ({ ...o, percent: percent(o.count, answered) })),
  }
}

function rankingSeries(q: Question, values: unknown[], total: number): AnalysisSeries[] {
  const schema = answerSchema(q)
  const rankings: Ranking[] = values.flatMap(value => {
    const parsed = schema.safeParse(value)
    return parsed.success ? [parsed.data as Ranking] : []
  })
  return (q.options ?? []).map(option => ({
    id: `${q.id}:rank:${option.value}`, questionID: q.id, rowID: option.value, block: q.block,
    label: `${q.label} · ${option.label}`, kind: q.kind, display: 'distribution', multipleChoice: false,
    eligible: values.length, answered: rankings.length, missing: values.length - rankings.length, notAsked: total - values.length,
    options: (q.options ?? []).map((_, position) => {
      const count = rankings.filter(ranking => ranking.order[position] === option.value).length
      return { value: String(position + 1), label: `Platz ${position + 1}`, count, percent: percent(count, rankings.length) }
    }),
  }))
}

/** One deterministic calculation for the team UI, SVG export and MCP projection. */
export function analyze(def: Definition, records: AnalysisRecord[], survey: AnalysisReport['survey'], now = new Date()): AnalysisReport {
  if (records.length > ANALYSIS_LIMIT) throw new Error('Mehr als 1.000 Antworten: paginierte Auswertung erforderlich. Es werden keine Teilergebnisse angezeigt.')
  const dates = records.map(r => r.createdAt?.slice(0, 10)).filter((v): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)).sort()
  const real = records.some(record => record.testOnly === false)
  const test = records.some(record => record.testOnly !== false)
  const dataset = real ? test ? 'mixed' : 'real' : records.length || survey.phase !== 'live' ? 'test' : 'real'
  return {
    schemaVersion: 1, survey: { ...survey, version: def.version }, dataset, responses: records.length,
    unit: 'Antworten, keine unabhängigen Organisationen', generatedAt: now.toISOString(), firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null,
    sections: def.sections.map(section => ({ id: section.id, title: section.title, series: section.questions.flatMap(q => {
      const values = records.filter(r => visible(q, r.answers)).map(r => r.answers[q.id])
      if (q.kind === 'ranking') return rankingSeries(q, values, records.length)
      return q.kind === 'matrix' || q.kind === 'counts'
        ? (q.rows ?? []).map(row => series(q, values.map(v => object(v)[row.key]), records.length, row))
        : [series(q, values, records.length)]
    }) })),
    notes: [
      dataset === 'test' ? 'Nur Testantworten der gewählten gespeicherten Fassung; keine Forschungsdaten.' : dataset === 'real' ? 'Antworten der gewählten gespeicherten Erhebungsfassung.' : 'Diese Fassung enthält Testantworten und echte Antworten; vor Verwendung getrennt prüfen.',
      'Prozente beziehen sich auf die beantwortete Frage bzw. Bewertungszeile. Fehlende Angaben und übersprungene Fragen werden getrennt gezählt.',
      'Mehrfachauswahl: Eine Antwort zählt je gewählter Option einmal. Die Prozentsumme kann über 100 % liegen.',
      'Schieberegler, Sterne und Smileys zeigen Häufigkeiten der gültigen Stufen. Rangordnungen zeigen je Option die Häufigkeit jedes Platzes; Prozentbasis sind nur vollständig gültige Rangordnungen. Teilweise oder ungültige Rangordnungen zählen als fehlend.',
      'Keine Gesamtnote, Mittelwerte oder Rangfolge von Organisationen. Weiß nicht und nicht zutreffend sind eigene Kategorien.',
      'Freitexte, individuelle Zahlen aus Zahlenfragen, Namen und Kontaktangaben werden nicht ausgegeben. Zahlenfragen zeigen nur den Angabestatus.',
    ],
  }
}

/** Suppress whole series including denominators to prevent subtracting small cells from totals. */
export function forSharing(report: AnalysisReport): SharedAnalysisReport {
  const small = (n: number) => n > 0 && n < MINIMUM_GROUP
  const overall = report.responses < MINIMUM_GROUP
  const hasSmallCell = (s: AnalysisSeries) => [s.eligible, s.answered, s.missing, s.notAsked, ...s.options.map(o => o.count)].some(small)
  const sections = report.sections.map(section => {
    // All options share a complete ranking: complementary rows could reveal a hidden rank.
    const suppressedRankings = new Set(section.series.filter(s => s.kind === 'ranking' && hasSmallCell(s)).map(s => s.questionID))
    return { ...section, series: section.series.map((s): SharedAnalysisSeries => {
      const suppressed = overall || hasSmallCell(s) || (s.kind === 'ranking' && suppressedRankings.has(s.questionID))
      return suppressed ? { ...s, eligible: null, answered: null, missing: null, notAsked: null, options: [], suppressed,
        reason: 'Fallzahlen unter fünf: gesamte Reihe einschließlich Bezugsgrößen zurückgehalten.' }
        : { ...s, suppressed }
    }) }
  })
  return { ...report, responses: overall ? null : report.responses, firstDate: null, lastDate: null, sections,
    audience: 'aggregate-sharing', minimumGroup: MINIMUM_GROUP,
    suppressed: overall || sections.some(s => s.series.some(r => r.suppressed)),
    notes: [...report.notes, 'Für MCP und Berichte werden positive Fallzahlen unter fünf einschließlich ergänzender Bezugsgrößen zurückgehalten. Keine Datumsfilter oder Untergruppen.',
      'Bei Rangordnungen wird die gesamte Frage mit allen Optionsreihen zurückgehalten, sobald eine Reihe geschützt werden muss; ergänzende Platzverteilungen könnten sonst kleine Zellen offenlegen.',
      'Diese Mindestfallzahl ist keine Garantie für Anonymität. Kontextwissen und wiederholte Auswertungen können Rückschlüsse ermöglichen. Freigabe vor externer Weitergabe prüfen.'],
  }
}
