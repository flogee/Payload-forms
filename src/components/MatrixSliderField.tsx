'use client'
import { participantText, type ParticipantLanguage } from '@/survey/participant-language'
import { useId } from 'react'
import type { Answer, Option, Question } from '@/survey/types'
import './MatrixSliderField.css'

export function MatrixSliderField({ q, scale, unknown, value, onChange, invalid, describedBy, language = 'de' }: {
  language?: ParticipantLanguage
  q: Question; scale: Option[]; unknown: Option; value?: Answer
  onChange: (value: Answer | undefined) => void; invalid?: boolean; describedBy?: string
}) {
  const t = participantText(language)
  const namespace = useId()
  const answers = value as Record<string, string> | undefined
  const hintID = `${namespace}-hint`
  const update = (key: string, selected?: string) => {
    const next = { ...answers }
    if (selected === undefined) delete next[key]
    else next[key] = selected
    onChange(Object.keys(next).length ? next : undefined)
  }
  return <div className="matrix-sliders">
    <p className="matrix-sliders__hint" id={hintID}>{t("Wähle je Aussage eine der fünf Stufen oder „{0}“. Du kannst Aussagen offenlassen.", unknown.label)}</p>
    {q.rows?.map((row, index) => {
      const id = `${namespace}-row-${index}`
      const selected = scale.find(option => option.value === answers?.[row.key])
      const cannotJudge = answers?.[row.key] === unknown.value
      const status = selected ? t("{0} von 5 · {1}", selected.value, selected.label) : cannotJudge ? unknown.label : t("Noch keine Bewertung")
      return <fieldset key={row.key} className="matrix-sliders__row" aria-describedby={[describedBy, hintID].filter(Boolean).join(' ')} aria-invalid={invalid || undefined}>
        <legend id={`${id}-label`}>{row.label}</legend>
        <p className={`matrix-sliders__status${selected || cannotJudge ? ' matrix-sliders__status--answered' : ''}`} id={`${id}-status`} aria-live="polite" aria-atomic="true">{status}</p>
        <div className={`matrix-sliders__scale${selected ? ' matrix-sliders__scale--selected' : ''}`}>
          <input className="matrix-sliders__range" type="range" min={1} max={5} step={1}
            value={selected ? Number(selected.value) : 3} aria-labelledby={`${id}-label`} aria-describedby={[describedBy, hintID, `${id}-status`].filter(Boolean).join(' ')}
            aria-valuetext={selected ? t("{0} von 5: {1}", selected.value, selected.label) : t("{0}. Wähle mit den Pfeiltasten eine Bewertung.", status)}
            aria-invalid={invalid || undefined} onChange={event => update(row.key, event.currentTarget.value)}
            onPointerUp={event => { if (event.button === 0) update(row.key, event.currentTarget.value) }}
            onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) update(row.key, event.currentTarget.value) }} />
          <div className="matrix-sliders__labels" aria-hidden="true">{scale.map(option => <span key={option.value} className={selected?.value === option.value ? 'matrix-sliders__label--selected' : undefined}><b>{option.value}</b></span>)}</div>
          <div className="matrix-sliders__captions" aria-hidden="true">{scale.map(option => <span key={option.value}>{option.label}</span>)}</div>
        </div>
        <div className="matrix-sliders__separate">
          <label className="matrix-sliders__unknown"><input type="checkbox" checked={cannotJudge} onChange={event => update(row.key, event.currentTarget.checked ? unknown.value : undefined)} /><span>{unknown.label}</span></label>
        </div>
      </fieldset>
    })}
  </div>
}
