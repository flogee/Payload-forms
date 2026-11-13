import type { AnalysisReport, AnalysisSeries } from './analysis-types'
import type { Answers, Definition, Question } from './types'

/** Human-only report data. Never add these fields to AnalysisReport or forSharing. */
export type ReportRecord = { id: number | string; answers: Answers; createdAt?: string; durationSeconds?: number; testOnly?: boolean }
export type ReportEntry = { responseID: number | string; text: string }
export type NumericReport = {
  rowID?: string; label: string; observations: number; minimum: number; maximum: number; median: number
  bins: { value: string; label: string; count: number; percent: number }[]
}
export type ReportQuestion = Pick<Question, 'id' | 'block' | 'label' | 'kind' | 'help'> & {
  series: AnalysisSeries[]; entries: ReportEntry[]; numeric: NumericReport[]
}
export type SurveyReport = {
  aggregate: AnalysisReport
  sections: { id: string; title: string; questions: ReportQuestion[] }[]
  dataset: 'real' | 'test'; excludedResponses: number; totalResponses: number
  medianDurationSeconds: number | null
}
export type ReportBuildInput = {
  definition: Definition; records: ReportRecord[]; aggregate: AnalysisReport
  dataset: 'real' | 'test'; excludedResponses: number
}
