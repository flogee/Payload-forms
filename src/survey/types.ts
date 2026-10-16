export type Option = { value: string; label: string; exclusive?: boolean }
export type Row = { key: string; label: string }
export type Question = {
  id: string; block: string; label: string; kind: 'text' | 'textarea' | 'single' | 'multiple' | 'count' | 'matrix' | 'counts' | 'committees' | 'slider' | 'stars' | 'smiley' | 'ranking';
  help?: string; options?: Option[]; rows?: Row[]; allowNA?: boolean; min?: number; max?: number;
  step?: number; lowLabel?: string; highLabel?: string;
  showIf?: { field: string; values: string[] }; optional?: boolean
}
import type { ContentBlock } from './content'
export type Section = { id: string; title: string; description?: string; questions: Question[]; content?: ContentBlock[] }
export type Definition = { version: string; introduction: string[]; sections: Section[]; introContent?: ContentBlock[] }
export type Choice = { choice: string | string[]; other?: string }
export type Count = { status: 'value' | 'unknown' | 'na'; value?: number; note?: string }
export type Ranking = { order: string[] }
export type Answer = string | number | Choice | Count | Ranking | Record<string, string | Count> | { body: string; volume: string }[]
export type Answers = Record<string, Answer>
