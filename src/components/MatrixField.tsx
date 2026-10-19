'use client'
import { useId, useRef, type CSSProperties } from 'react'
import type { Answer, Question } from '@/survey/types'
import './MatrixField.css'

export function MatrixField({ q, value, onChange, invalid, describedBy }: {
  q: Question
  value?: Answer
  onChange: (value: Answer | undefined) => void
  invalid?: boolean
  describedBy?: string
}) {
  const namespace = useId()
  const firstChoices = useRef<(HTMLInputElement | null)[]>([])
  const answers = value as Record<string, string> | undefined
  const options = q.options || []
  const description = [describedBy, `${namespace}-hint`].filter(Boolean).join(' ')
  const update = (key: string, selected?: string) => {
    const next = { ...answers }
    if (selected === undefined) delete next[key]
    else next[key] = selected
    onChange(Object.keys(next).length ? next : undefined)
  }

  return <div className="matrix-field" style={{ '--matrix-options': options.length } as CSSProperties}>
    <p className="matrix-field__hint" id={`${namespace}-hint`}>Je Zeile eine Auswahl. Du kannst Zeilen offenlassen.</p>
    <div className="matrix-field__scroll" role="region" aria-label={`${q.label}: Bewertungstabelle`} tabIndex={0}>
      <table className="matrix-field__table" role="table">
        <caption className="matrix-field__sr-only">{q.label}</caption>
        <thead role="rowgroup"><tr role="row">
          <th scope="col" role="columnheader">Aussage</th>
          {options.map((option, index) => <th key={option.value} scope="col" role="columnheader" id={`${namespace}-option-${index}`}>{option.label}</th>)}
        </tr></thead>
        <tbody role="rowgroup">{q.rows?.map((row, rowIndex) => <tr key={row.key} role="row">
          <th scope="row" role="rowheader">
            <span id={`${namespace}-row-${rowIndex}`}>{row.label}</span>
            <button type="button" className="clear matrix-field__reset" disabled={answers?.[row.key] === undefined} aria-label={`${row.label}: Auswahl zurücksetzen`} onClick={() => {
              update(row.key)
              firstChoices.current[rowIndex]?.focus()
            }}>Zurücksetzen</button>
          </th>
          {options.map((option, optionIndex) => <td key={option.value} role="cell">
            <label className="matrix-field__choice">
              <input ref={optionIndex === 0 ? element => { firstChoices.current[rowIndex] = element } : undefined}
                type="radio" name={`${namespace}-row-${rowIndex}`} value={option.value}
                checked={answers?.[row.key] === option.value}
                aria-labelledby={`${namespace}-row-${rowIndex} ${namespace}-option-${optionIndex}`}
                aria-describedby={description} aria-invalid={invalid || undefined}
                onChange={() => update(row.key, option.value)} />
              <span className="matrix-field__mobile-label" aria-hidden="true">{option.label}</span>
            </label>
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>
}
