'use client'

import { useRef, useState } from 'react'
import type { Answer, Question, Ranking } from '@/survey/types'
import { ratingLabels, sliderSettings } from '@/survey/voting'
import './VotingField.css'

type Props = {
  q: Question
  value?: Answer
  onChange: (value: Answer | undefined) => void
  describedBy?: string
  invalid?: boolean
}

function RatingIcon({ kind, tier, filled }: { kind: 'stars' | 'smiley'; tier: number; filled: boolean }) {
  if (kind === 'stars') return <svg viewBox="0 0 32 32" aria-hidden="true" className={`voting-icon ${filled ? 'voting-icon--filled' : ''}`}><path d="m16 3 4 8.2 9 1.3-6.5 6.4 1.5 9-8-4.3-8 4.3 1.5-9L3 12.5l9-1.3Z" /></svg>
  const mouths = ['M10 23 Q16 15 22 23', 'M11 22 Q16 18 21 22', 'M11 21 H21', 'M10 19 Q16 25 22 19', 'M9 18 Q16 28 23 18']
  return <svg viewBox="0 0 32 32" aria-hidden="true" className={`voting-icon voting-icon--face ${filled ? 'voting-icon--filled' : ''}`}><circle cx="16" cy="16" r="13" /><path d="M11 12v1M21 12v1" /><path d={mouths[tier - 1]} /></svg>
}

function SliderField({ q, value, onChange, describedBy, invalid }: Props) {
  const { min, max, step } = sliderSettings(q)
  const selected = typeof value === 'number' ? value : undefined
  const tentative = min + Math.round((max - min) / step / 2) * step
  const shown = selected ?? tentative
  const hintID = `${q.id}-slider-hint`
  const description = [describedBy, hintID].filter(Boolean).join(' ')
  return <div className="voting-field voting-slider">
    <div className="voting-slider__controls">
      <div className="voting-slider__track">
        <div className="voting-slider__ends"><span>{q.lowLabel || min}</span><span>{q.highLabel || max}</span></div>
        <label className="voting-sr-only" htmlFor={`${q.id}-range`}>{q.label}: Regler</label>
        <input className="voting-slider__range" id={`${q.id}-range`} type="range" min={min} max={max} step={step} value={shown} aria-describedby={description} aria-invalid={invalid || undefined} aria-valuetext={selected === undefined ? `${shown}, noch keine Angabe; mit den Pfeiltasten wählen` : String(selected)} onChange={e => onChange(Number(e.target.value))} onPointerUp={e => onChange(Number(e.currentTarget.value))} onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) onChange(Number(e.currentTarget.value)) }} />
      </div>
      <div className="voting-slider__entry"><label htmlFor={`${q.id}-number`}>Dein Wert</label><input id={`${q.id}-number`} type="number" inputMode="numeric" min={min} max={max} step={step} value={selected ?? ''} placeholder="—" aria-describedby={description} aria-invalid={invalid || undefined} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} /></div>
    </div>
    <div className="voting-meta">
      <p id={hintID} className="voting-slider__hint">{selected === undefined && <>Noch keine Angabe · </>}{min}–{max} · Schritte: {step}<span className="voting-sr-only">. Bewege den Regler oder gib eine Zahl ein. Die Startposition ist noch keine Antwort.</span></p>
      {selected !== undefined && <button type="button" className="voting-clear" onClick={() => onChange(undefined)}>Angabe zurücksetzen</button>}
    </div>
    <span className="voting-sr-only" aria-live="polite">{selected === undefined ? 'Noch keine Angabe' : `Gewählt: ${selected}`}</span>
  </div>
}

function RatingField({ q, value, onChange, describedBy, invalid }: Props) {
  const selected = typeof value === 'number' ? value : undefined
  const labels = ratingLabels(q)
  const firstRadio = useRef<HTMLInputElement>(null)
  const kind = q.kind === 'stars' ? 'stars' : 'smiley'
  const hintID = `${q.id}-rating-hint`
  return <div className="voting-field">
    <p id={hintID} className="voting-sr-only">Wähle eine der fünf Bewertungen. Mit den Pfeiltasten kannst du die Auswahl ändern.</p>
    <div className="voting-rating-scale">
      <div className="voting-rating" role="radiogroup" aria-label={q.label} aria-describedby={[describedBy, hintID].filter(Boolean).join(' ')} aria-invalid={invalid || undefined}>
        {labels.map((label, index) => { const tier = index + 1; return <label key={tier} title={`${tier} von 5: ${label}`} className={`voting-rating__choice ${selected === tier ? 'voting-rating__choice--selected' : ''}`}><input ref={tier === 1 ? firstRadio : undefined} type="radio" name={`${q.id}-rating`} value={tier} checked={selected === tier} onChange={() => onChange(tier)} aria-label={`${tier} von 5: ${label}`} /><RatingIcon kind={kind} tier={tier} filled={kind === 'stars' ? selected !== undefined && tier <= selected : selected === tier} /></label> })}
      </div>
      <div className="voting-rating__ends"><span>{labels[0]}</span><span>{labels[4]}</span></div>
    </div>
    <div className="voting-meta">
      <p className="voting-status" aria-live="polite">{selected === undefined ? 'Noch keine Angabe' : `${selected} von 5 · ${labels[selected - 1]}`}</p>
      {selected !== undefined && <button type="button" className="voting-clear" onClick={() => { onChange(undefined); requestAnimationFrame(() => firstRadio.current?.focus()) }}>Bewertung zurücksetzen</button>}
    </div>
  </div>
}

function MoveIcon({ down = false }: { down?: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d={down ? 'M5 7l5 5 5-5' : 'M5 12l5-5 5 5'} /></svg>
}

function RankingField({ q, value, onChange, describedBy, invalid }: Props) {
  const options = q.options || []
  const order = value && typeof value === 'object' && 'order' in value && Array.isArray(value.order) ? (value as Ranking).order : []
  const remaining = options.filter(option => !order.includes(option.value))
  const items = useRef(new Map<string, HTMLLIElement>())
  const choices = useRef(new Map<string, HTMLButtonElement>())
  const [announcement, setAnnouncement] = useState('')
  const hintID = `${q.id}-ranking-hint`
  const focusItem = (key: string) => requestAnimationFrame(() => items.current.get(key)?.focus())
  const update = (next: string[]) => onChange(next.length ? { order: next } : undefined)
  const move = (key: string, delta: number) => {
    const index = order.indexOf(key), next = [...order]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    update(next)
    setAnnouncement(`${options.find(option => option.value === key)?.label}: jetzt Platz ${index + delta + 1}.`)
    focusItem(key)
  }
  const remove = (key: string) => {
    update(order.filter(item => item !== key))
    setAnnouncement(`${options.find(option => option.value === key)?.label} ist wieder ohne Platz.`)
    requestAnimationFrame(() => choices.current.get(key)?.focus())
  }
  return <div className="voting-field voting-ranking" role="group" aria-label={q.label} aria-describedby={[describedBy, hintID].filter(Boolean).join(' ')} aria-invalid={invalid || undefined}>
    <p id={hintID} className="voting-instruction">Wähle zuerst deinen ersten Platz, dann die weiteren. Ordne alle {options.length} Möglichkeiten zu oder lass die Frage ganz offen.</p>
    <p className="voting-status">{order.length === 0 ? 'Noch keine Rangfolge' : order.length === options.length ? `Rangfolge vollständig: ${order.length} Plätze` : `${order.length} von ${options.length} Plätzen vergeben · bitte alle zuordnen`}</p>
    {order.length > 0 && <><h3 className="voting-ranking__heading">Deine Rangfolge</h3><ol className="voting-ranking__ordered">{order.map((key, index) => { const label = options.find(option => option.value === key)?.label || key; return <li key={key} tabIndex={-1} ref={node => { if (node) items.current.set(key, node); else items.current.delete(key) }} aria-label={`Platz ${index + 1}: ${label}`}><span className="voting-ranking__position" aria-hidden="true">{index + 1}</span><span className="voting-ranking__label">{label}</span><div className="voting-ranking__actions"><button type="button" className="voting-ranking__move" disabled={index === 0} aria-label={`${label} einen Platz nach oben`} onClick={() => move(key, -1)}><MoveIcon /></button><button type="button" className="voting-ranking__move" disabled={index === order.length - 1} aria-label={`${label} einen Platz nach unten`} onClick={() => move(key, 1)}><MoveIcon down /></button><button type="button" className="voting-ranking__remove" aria-label={`${label} aus der Rangfolge entfernen`} onClick={() => remove(key)}>Entfernen</button></div></li> })}</ol></>}
    {remaining.length > 0 && <><h3 className="voting-ranking__heading">{order.length ? `Noch offen · wähle Platz ${order.length + 1}` : 'Möglichkeiten · wähle Platz 1'}</h3><ul className="voting-ranking__available">{remaining.map(option => <li key={option.value}><button type="button" className="voting-button" ref={node => { if (node) choices.current.set(option.value, node); else choices.current.delete(option.value) }} onClick={() => { update([...order, option.value]); setAnnouncement(`${option.label}: Platz ${order.length + 1} vergeben.`); focusItem(option.value) }}><span>{option.label}</span><span className="voting-ranking__add">Auf Platz {order.length + 1}</span></button></li>)}</ul></>}
    <p className="voting-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    {order.length > 0 && <button type="button" className="voting-clear" onClick={() => { onChange(undefined); setAnnouncement('Rangfolge zurückgesetzt. Alle Möglichkeiten sind wieder offen.'); requestAnimationFrame(() => choices.current.get(options[0]?.value)?.focus()) }}>Rangfolge zurücksetzen</button>}
  </div>
}

export function VotingField(props: Props) {
  if (props.q.kind === 'slider') return <SliderField {...props} />
  if (props.q.kind === 'stars' || props.q.kind === 'smiley') return <RatingField {...props} />
  if (props.q.kind === 'ranking') return <RankingField {...props} />
  return null
}
