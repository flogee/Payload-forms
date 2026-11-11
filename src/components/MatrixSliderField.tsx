'use client'
import { useId, useRef } from 'react'
import type { Answer, Option, Question } from '@/survey/types'
import './MatrixSliderField.css'

export function MatrixSliderField({ q, scale, unknown, value, onChange, invalid, describedBy }: {
  q: Question; scale: Option[]; unknown: Option; value?: Answer
  onChange: (value: Answer | undefined) => void; invalid?: boolean; describedBy?: string
}) {
  const namespace = useId()
  const ranges = useRef<(HTMLInputElement | null)[]>([])
  const answers = value as Record<string, string> | undefined
  const hintID = `${namespace}-hint`
  const update = (key: string, selected?: string) => {
    const next = { ...answers }
    if (selected === undefined) delete next[key]
    else next[key] = selected
    onChange(Object.keys(next).length ? next : undefined)
  }
  return <div className="matrix-sliders">
    <p className="matrix-sliders__hint" id={hintID}>Wähle je Aussage eine der fünf Stufen oder „{unknown.label}“. Du kannst Aussagen offenlassen.</p>
    {q.rows?.map((row, index) => {
      const id = `${namespace}-row-${index}`
      const selected = scale.find(option => option.value === answers?.[row.key])
      const cannotJudge = answers?.[row.key] === unknown.value
      const status = selected ? `${selected.value} von 5 · ${selected.label}` : cannotJudge ? unknown.label : 'Noch keine Bewertung'
      return <fieldset key={row.key} className="matrix-sliders__row" aria-describedby={[describedBy, hintID].filter(Boolean).join(' ')} aria-invalid={invalid || undefined}>
        <legend id={`${id}-label`}>{row.label}</legend>
        <p className={`matrix-sliders__status${selected || cannotJudge ? ' matrix-sliders__status--answered' : ''}`} id={`${id}-status`} aria-live="polite" aria-atomic="true">{status}</p>
        <div className={`matrix-sliders__scale${selected ? ' matrix-sliders__scale--selected' : ''}`}>
          <input ref={element => { ranges.current[index] = element }} className="matrix-sliders__range" type="range" min={1} max={5} step={1}
            value={selected ? Number(selected.value) : 3} aria-labelledby={`${id}-label`} aria-describedby={[describedBy, hintID, `${id}-status`].filter(Boolean).join(' ')}
            aria-valuetext={selected ? `${selected.value} von 5: ${selected.label}` : `${status}. Wähle mit den Pfeiltasten eine Bewertung.`}
            aria-invalid={invalid || undefined} onChange={event => update(row.key, event.currentTarget.value)}
            onPointerUp={event => { if (event.button === 0) update(row.key, event.currentTarget.value) }}
            onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) update(row.key, event.currentTarget.value) }} />
          <div className="matrix-sliders__labels" aria-hidden="true">{scale.map(option => <span key={option.value} className={selected?.value === option.value ? 'matrix-sliders__label--selected' : undefined}><b>{option.value}</b></span>)}</div>
          <div className="matrix-sliders__captions" aria-hidden="true">{scale.map(option => <span key={option.value}>{option.label}</span>)}</div>
        </div>
        <div className="matrix-sliders__separate">
          <button type="button" className="matrix-sliders__reset" disabled={answers?.[row.key] === undefined} aria-label={`${row.label}: Bewertung zurücksetzen`} onClick={() => { update(row.key); ranges.current[index]?.focus() }}>Zurücksetzen</button>
          <label className="matrix-sliders__unknown"><input type="checkbox" checked={cannotJudge} onChange={event => update(row.key, event.currentTarget.checked ? unknown.value : undefined)} /><span>{unknown.label}</span></label>
        </div>
      </fieldset>
    })}
  </div>
}
