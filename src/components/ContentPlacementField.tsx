'use client'

import { FieldDescription, FieldError, FieldLabel, useField, useFormFields } from '@payloadcms/ui'
import type { TextFieldClientProps, Validate } from 'payload'
import { useCallback } from 'react'

export function ContentPlacementField({ field, path: pathFromProps, readOnly, validate }: TextFieldClientProps) {
  const validatePlacement = useCallback<Validate>((value, options) => {
    if (validate) return validate(value, { ...options, type: 'text', name: field.name, required: field.required, minLength: field.minLength, maxLength: field.maxLength })
  }, [validate, field.name, field.required, field.minLength, field.maxLength])
  const { path, value, setValue, disabled, showError, errorMessage } = useField<string>({ potentiallyStalePath: pathFromProps, validate: validatePlacement })
  const sectionPath = path.match(/^(sections\.\d+)\.content\.\d+\.afterQuestion$/)?.[1]
  const formFields = useFormFields(([fields]) => fields) || {}
  const questionPath = sectionPath ? `${sectionPath}.questions.` : undefined
  const options = questionPath ? Object.entries(formFields).flatMap(([key, state]) => {
    if (!key.startsWith(questionPath) || !/^\d+\.code$/.test(key.slice(questionPath.length))) return []
    const code = typeof state.value === 'string' ? state.value : ''
    if (!code) return []
    const label = formFields[`${key.slice(0, -4)}label`]?.value
    return [{ code, label: typeof label === 'string' ? label : '', index: Number(key.slice(questionPath.length).split('.')[0]) }]
  }).sort((a, b) => a.index - b.index) : []
  const id = `field-${path.replace(/\./g, '__')}`
  const descriptionID = `${id}-description`, errorID = `${id}-error`
  const description = field.admin?.description || 'Der Inhalt erscheint am Abschnittsanfang oder direkt nach der gewählten Frage, auch wenn diese durch eine Sprungregel ausgeblendet ist.'
  const locked = readOnly || disabled || !sectionPath
  const current = typeof value === 'string' ? value : ''

  return <div className={`field-type select ${showError ? 'error' : ''} ${locked ? 'read-only' : ''}`} style={field.admin?.style}>
    <FieldLabel htmlFor={id} path={path} label={field.label || 'Position im Abschnitt'} localized={field.localized} required={field.required} />
    <div className="field-type__wrap">
      <div id={errorID} role={showError ? 'alert' : undefined}><FieldError path={path} showError={showError} message={errorMessage} /></div>
      <select id={id} name={path} value={current} disabled={locked} aria-invalid={showError || undefined}
        aria-describedby={`${descriptionID}${showError ? ` ${errorID}` : ''}`} onChange={event => { if (!locked) setValue(event.target.value) }}
        style={{ width: '100%', minHeight: 'calc(var(--base) * 2)', padding: 'calc(var(--base) * .4) calc(var(--base) * .75)', font: 'inherit', color: 'var(--theme-text)', background: 'var(--theme-input-bg)', border: `1px solid var(${showError ? '--theme-error-500' : '--theme-elevation-150'})`, borderRadius: 'var(--style-radius-s)' }}>
        <option value="">Am Abschnittsanfang</option>
        {current && !options.some(option => option.code === current) && <option value={current}>Frage nicht mehr vorhanden: {current}</option>}
        {options.map(option => <option key={`${option.index}-${option.code}`} value={option.code}>Nach {option.code}{option.label ? ` · ${option.label}` : ''}</option>)}
      </select>
      <div id={descriptionID}><FieldDescription path={path} description={description} /></div>
    </div>
  </div>
}
