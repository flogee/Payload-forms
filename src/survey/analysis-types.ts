import type { Question } from './types'

export type AnalysisOption = { value: string; label: string; count: number; percent: number }
export type AnalysisSeries = {
  id: string; questionID: string; rowID?: string; block: string; label: string
  kind: Question['kind']; display: 'distribution' | 'completion' | 'count-status'
  eligible: number; answered: number; missing: number; notAsked: number
  multipleChoice: boolean; options: AnalysisOption[]
}
export type AnalysisSection = { id: string; title: string; series: AnalysisSeries[] }
export type AnalysisReport = {
  schemaVersion: 1
  survey: { id: number; title: string; slug: string; version: string; phase: string }
  dataset: 'test' | 'real' | 'mixed'; responses: number; unit: string; generatedAt: string
  firstDate: string | null; lastDate: string | null
  sections: AnalysisSection[]; notes: string[]
}
export type SharedAnalysisSeries = Omit<AnalysisSeries, 'eligible' | 'answered' | 'missing' | 'notAsked' | 'options'> & {
  eligible: number | null; answered: number | null; missing: number | null; notAsked: number | null
  options: AnalysisOption[]; suppressed: boolean; reason?: string
}
export type SharedAnalysisReport = Omit<AnalysisReport, 'responses' | 'sections' | 'firstDate' | 'lastDate'> & {
  responses: number | null; firstDate: string | null; lastDate: string | null
  audience: 'aggregate-sharing'; minimumGroup: 5; suppressed: boolean
  sections: { id: string; title: string; series: SharedAnalysisSeries[] }[]
}
