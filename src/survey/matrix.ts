import type { Option, Question } from './types'

/** Preserve arbitrary matrices; only the explicit 1–5 + unknown convention is ordinal. */
export function matrixSliderOptions(q: Question): { scale: Option[]; unknown: Option } | undefined {
  const options = q.options ?? []
  if (q.kind !== 'matrix' || options.length !== 6 || options[5].value !== 'unknown' ||
    options.slice(0, 5).some((option, index) => option.value !== String(index + 1) || option.exclusive)) return undefined
  return { scale: options.slice(0, 5), unknown: options[5] }
}
