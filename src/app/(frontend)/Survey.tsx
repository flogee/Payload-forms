'use client'
import { participantText, participantError, type ParticipantLanguage } from '@/survey/participant-language'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { Answer, Answers, Choice, Count, Definition, Question } from '@/survey/types'
import { hasAnswer, questions, validateSectionAnswers, visible, visibleSectionIndexes } from '@/survey/validation'
import type { ParticipantContact, PrivacyNotice as Notice } from '@/survey/privacy'
import { liveParticipantContactSchema, participantContactSchema } from '@/survey/privacy'
import { PrivacyNotice } from '@/components/PrivacyNotice'
import { ParticipantPrivacy } from '@/components/ParticipantPrivacy'
import { SurveyPrivacyDialog } from '@/components/SurveyPrivacyDialog'
import { SurveyContent } from '@/components/SurveyContent'
import { VotingField } from '@/components/VotingField'
import { MatrixField } from '@/components/MatrixField'
import { SurveyBrand } from '@/components/SurveyBrand'
import { ParticipantShare } from '@/components/ParticipantShare'
import type { SurveyBranding } from '@/survey/branding'
function CountInput({ id, label, q, value, onChange, language }: { id: string; language: ParticipantLanguage; label: string; q: Question; value?: Count; onChange: (value: Count | undefined) => void }) {
  const t = participantText(language)
  return <div className="count-row"><label htmlFor={`${id}-status`}>{label}</label><div className="count-controls"><select id={`${id}-status`} value={value?.status || ''} onChange={e => onChange(e.target.value ? { status: e.target.value as Count['status'] } : undefined)}><option value="">{t("Bitte wählen")}</option><option value="value">{t("Zahl eingeben")}</option><option value="unknown">{t("Weiß nicht")}</option>{q.allowNA && <option value="na">{t("Nicht zutreffend")}</option>}</select>{value?.status === 'value' && <input aria-label={`${label}: ${t("Zahl")}`} inputMode="numeric" type="number" min={q.min ?? 0} max={q.max ?? 100000000} step={1} value={value.value ?? ''} onChange={e => onChange({ ...value, value: e.target.value === '' ? undefined : Number(e.target.value) })} />}</div>{value && <input className="count-note" aria-label={`${label}: ${t("Hinweis")}`} placeholder={t("Hinweis zur Zahl (optional)")} maxLength={500} value={value.note || ''} onChange={e => onChange({ ...value, note: e.target.value })} />}</div>
}
function Field({ q, value, onChange, error, hideQuestionCodes, language }: { q: Question; language: ParticipantLanguage; hideQuestionCodes: boolean; value?: Answer; onChange: (value: Answer | undefined) => void; error?: string }) {
  const t = participantText(language)
  const choice = value as Choice | undefined, id = q.id
  const statusLabel = q.required ? t("Pflichtfrage") : q.optional ? t("optional") : undefined
  let input: React.ReactNode
  if (q.kind === 'text' || q.kind === 'textarea') input = q.kind === 'text' ? <input id={id} aria-label={q.label} value={typeof value === 'string' ? value : ''} maxLength={1000} onChange={e => onChange(e.target.value)} /> : <textarea id={id} aria-label={q.label} rows={4} value={typeof value === 'string' ? value : ''} maxLength={4000} onChange={e => onChange(e.target.value)} />
  if (q.kind === 'single' || q.kind === 'multiple') {
    const picked = Array.isArray(choice?.choice) ? choice.choice : choice?.choice ? [choice.choice] : []
    input = <><div className="choices">{q.options?.map(o => <label key={o.value} className={`choice ${picked.includes(o.value) ? 'chosen' : ''}`}><input type={q.kind === 'single' ? 'radio' : 'checkbox'} name={id} value={o.value} checked={picked.includes(o.value)} onChange={e => {
      let next: string | string[] = o.value
      if (q.kind === 'multiple') next = e.target.checked ? o.exclusive ? [o.value] : [...picked.filter(v => !q.options?.find(x => x.value === v)?.exclusive), o.value] : picked.filter(v => v !== o.value)
      onChange({ choice: next, ...(Array.isArray(next) ? next.includes('other') : next === 'other') && choice?.other ? { other: choice.other } : {} })
    }} /><span>{o.label}</span></label>)}</div>{picked.includes('other') && <input aria-label={`${q.label}: ${t("Andere Angabe")}`} placeholder={t("Bitte kurz ergänzen")} value={choice?.other || ''} maxLength={2000} onChange={e => onChange({ choice: choice!.choice, other: e.target.value })} />}{q.kind === 'single' && picked.length > 0 && <button type="button" className="clear" onClick={() => onChange(undefined)}>{t("Auswahl zurücksetzen")}</button>}</>
  }
  if (q.kind === 'slider' || q.kind === 'stars' || q.kind === 'smiley' || q.kind === 'ranking') input = <VotingField language={language} q={q} value={value} onChange={onChange} invalid={Boolean(error)} describedBy={[q.help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} />
  if (q.kind === 'count') input = <CountInput language={language} id={id} label={t("Angabe")} q={q} value={value as Count} onChange={onChange} />
  if (q.kind === 'counts') input = <div className="matrix">{q.rows?.map(r => <CountInput language={language} key={r.key} id={`${id}-${r.key}`} label={r.label} q={q} value={(value as Record<string, Count> | undefined)?.[r.key]} onChange={v => { const updated = { ...(value as Record<string, Count> || {}) }; if (v) updated[r.key] = v; else delete updated[r.key]; onChange(updated) }} />)}</div>
  if (q.kind === 'matrix') input = <MatrixField language={language} q={q} value={value} onChange={onChange} invalid={Boolean(error)} describedBy={[q.help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} />
  if (q.kind === 'committees') {
    const rows = Array.isArray(value) ? value as { body: string; volume: string }[] : [{ body: '', volume: '' }, { body: '', volume: '' }, { body: '', volume: '' }]
    const update = (i: number, key: 'body' | 'volume', text: string) => onChange(rows.map((r, j) => j === i ? { ...r, [key]: text } : r))
    input = <><div className="committee-list">{rows.map((r, i) => <div className="committee-row" key={i}><div className="row-title">{t("Gremium {0}", i + 1)}{i > 2 && <button type="button" className="clear" aria-label={t("Gremium {0} entfernen", i + 1)} onClick={() => onChange(rows.filter((_, j) => j !== i))}>{t("Entfernen")}</button>}</div><label>{t("Art oder Bezeichnung")}<input aria-label={t("Gremium {0}: Art oder Bezeichnung", i + 1)} maxLength={300} value={r.body} onChange={e => update(i, 'body', e.target.value)} /></label><label>{t("Entscheidungen in den letzten zwölf Monaten")}<input aria-label={t("Gremium {0}: Entscheidungszahl", i + 1)} maxLength={200} placeholder={t("z. B. 20–30 oder weiß nicht")} value={r.volume} onChange={e => update(i, 'volume', e.target.value)} /></label></div>)}</div>{rows.length < 30 && <button className="secondary small" type="button" onClick={() => onChange([...rows, { body: '', volume: '' }])}>{t("+ Weiteres Gremium")}</button>}</>
  }
  return <fieldset className={`question ${error ? 'invalid' : ''}`} aria-invalid={error ? true : undefined} aria-describedby={[q.help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}><legend>{!hideQuestionCodes && <span className="question-code">{q.block}</span>}{q.label}{statusLabel && <span className="optional">{statusLabel}</span>}</legend>{q.help && <p id={`${id}-help`} className="help">{q.help}</p>}{input}{error && <p id={`${id}-error`} className="error" role="alert">{participantError(language, error, "Bitte prüfe diese Angabe.")}</p>}</fieldset>
}
export function Survey({ testOnly = true, definition, language = 'de', hideQuestionCodes = false, instrumentRevision, branding = { mode: 'default' }, surveyID, title = 'Fictional sample questionnaire', homeURL, privacy, privacyHash, evaluationRun }: { testOnly?: boolean; definition: Definition; language?: ParticipantLanguage; hideQuestionCodes?: boolean; instrumentRevision?: string; branding?: SurveyBranding; surveyID: number; title?: string; homeURL: string; privacy?: Notice; privacyHash?: string; evaluationRun?: { key: string; token: string } }) {
  const t = participantText(language)
  const [step, setStep] = useState(-1), [answers, setAnswers] = useState<Answers>({}), [errors, setErrors] = useState<Record<string, string>>({}), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false), [contactConsent, setContactConsent] = useState(false), [contact, setContact] = useState<Partial<ParticipantContact>>({})
  const started = useRef(0), submission = useRef(''), heading = useRef<HTMLHeadingElement>(null)
  const registration = privacy?.contactMode === 'email-only'
  const confirmed = confirm || (registration && !testOnly)
  useEffect(() => { if (saved) { window.scrollTo({ top: 0, behavior: 'instant' }); heading.current?.focus() } }, [saved])
  const sections = definition.sections, review = step === sections.length, all = questions(definition), applicable = all.filter(q => visible(q, answers)), completed = applicable.filter(q => hasAnswer(answers[q.id])).length
  const sectionIndexes = visibleSectionIndexes(definition, answers)
  const previousStep = sectionIndexes.filter(index => index < step).at(-1) ?? -1
  const progress = review ? sectionIndexes.length : sectionIndexes.indexOf(step)
  const isLastSection = step === sectionIndexes.at(-1)
  const blocks = new Set(all.map(q => q.block)).size
  const introHelp = all.some(q => q.required)
    ? t("Bitte beantworte die Pflichtfragen. Dein Zwischenstand bleibt erhalten, solange diese Seite geöffnet ist. Beim Neuladen geht er verloren.")
    : t("Alle Fragen zum Inhalt können übersprungen werden. Dein Zwischenstand bleibt erhalten, solange diese Seite geöffnet ist. Beim Neuladen geht er verloren.")
  // Keep the validated Run grant during header navigation, without adding its
  // credential query to the separate, strictly scoped media base path.
  const navigationURL = evaluationRun ? `${homeURL}?${new URLSearchParams({ run: evaluationRun.key, access: evaluationRun.token })}` : homeURL
  const go = (index: number) => { setStep(index); setErrors({}); setMessage(''); window.scrollTo({ top: 0, behavior: 'instant' }); setTimeout(() => heading.current?.focus(), 0) }
  const begin = () => { started.current = Date.now(); submission.current = crypto.randomUUID(); go(sectionIndexes[0] ?? sections.length) }
  const next = () => {
    const checked = validateSectionAnswers(definition, answers, sections[step].id)
    if (Object.keys(checked.errors).length) { setErrors(checked.errors); setMessage(t("Bitte prüfe die markierten Angaben, bevor du weitergehst.")); return }
    setAnswers(checked.answers)
    const nextStep = visibleSectionIndexes(definition, checked.answers).find(index => index > step)
    go(nextStep ?? sections.length)
  }
  const submit = async () => {
    if (!confirmed || busy) return
    if (privacy?.legalBasis === 'consent' && !consent) { setMessage(t("Bitte die Zustimmung zur Verarbeitung der Antworten bestätigen.")); return }
    if ((registration || privacy?.contactMode === 'required') && !contactConsent) { setMessage(t("Für diese Fassung sind Kontaktangaben und die gesonderte Zustimmung erforderlich.")); return }
    const contactSchema = testOnly && !registration ? participantContactSchema : liveParticipantContactSchema
    if (contactConsent && (!contactSchema.safeParse(contact).success || (testOnly && !contact.email?.toLowerCase().endsWith('.invalid')))) {
      setMessage(!testOnly ? t("Bitte eine gültige E-Mail-Adresse ergänzen.") : registration
        ? t("Bitte eine gültige Test-E-Mail mit der Endung .invalid eingeben.")
        : t("Bitte einen erfundenen Namen und eine gültige Test-E-Mail mit der Endung .invalid ergänzen."))
      return
    }
    if (registration && !submission.current) {
      started.current = Date.now()
      submission.current = crypto.randomUUID()
    }
    setBusy(true); setMessage('')
    try {
      const res = await fetch('/api/survey/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surveyID, instrumentRevision, version: definition.version, submissionID: submission.current, durationSeconds: Math.min(86400, Math.max(0, Math.round((Date.now() - started.current) / 1000))), ...(testOnly ? { confirmTest: confirmed } : { confirmParticipation: confirmed }), answers, website: '',
        ...(evaluationRun ? { evaluationRun } : {}),
        ...(privacy ? { privacy: { noticeHash: privacyHash, consent, contactConsent }, ...(contactConsent ? { contact } : {}) } : {}),
      }) })
      const result = await res.json() as { fields?: Record<string, string>; error?: string; saved?: boolean }
      if (!res.ok) { setErrors(result.fields || {}); setMessage(participantError(language, result.error, t("Speichern fehlgeschlagen. Bitte erneut versuchen."))); return }
      setSaved(true); setAnswers({}); setConfirm(false); setConsent(false); setContactConsent(false); setContact({})
    } catch { setMessage(t("Keine Verbindung. Deine Angaben bleiben auf dieser Seite erhalten. Bitte erneut versuchen.")) }
    finally { setBusy(false) }
  }
  if (registration) return <div className="shell" lang={language}>
    <header className="topbar survey-topbar">
      <SurveyBrand language={language} branding={branding} homeURL={homeURL} navigationURL={navigationURL} />
      {testOnly && <span className="test-tag">{t("Pretest mit Testdaten")}</span>}
    </header>
    <main className="registration">
      {saved ? <section className="success">
        <h1 tabIndex={-1} ref={heading}>{testOnly ? t("Testanmeldung gespeichert") : t("Anmeldung gespeichert")}</h1>
        {testOnly && <p>{t("Die Anmeldung wurde als Testdatensatz gespeichert.")}</p>}
        {definition.thankYouContent && <SurveyContent language={language} blocks={[{ blockType: 'text', content: definition.thankYouContent }]} homeURL={homeURL} />}
      </section> : <>
        <h1>{title}</h1>
        {definition.introduction.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        <SurveyContent language={language} blocks={definition.introContent} homeURL={homeURL} />
        <form onSubmit={event => { event.preventDefault(); void submit() }}>
          <label className="registration-email" htmlFor="registration-email">{t("E-Mail-Adresse")}</label>
          <input id="registration-email" name="email" type="email" value={contact.email ?? ''}
            maxLength={254} autoComplete={testOnly ? 'off' : 'email'} required disabled={busy}
            aria-describedby={testOnly ? 'registration-test-help' : undefined}
            onChange={event => setContact({ email: event.target.value })} />
          {testOnly && <p id="registration-test-help" className="help">{t("Nur erfundene E-Mail-Adressen mit der Endung .invalid verwenden, zum Beispiel test@example.invalid.")}</p>}
          {privacy.legalBasis === 'consent' && privacy.consentText !== privacy.contactConsentText && <label className="test-confirm registration-confirm">
            <input type="checkbox" required checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
            <span>{privacy.consentText}</span>
          </label>}
          <label className="test-confirm registration-confirm">
            <input type="checkbox" required checked={contactConsent} disabled={busy} onChange={event => {
              const accepted = event.target.checked
              setContactConsent(accepted)
              if (testOnly) setConfirm(accepted)
              if (privacy.legalBasis === 'consent' && privacy.consentText === privacy.contactConsentText) setConsent(accepted)
            }} />
            <span>
              {privacy.contactConsentText}
              {testOnly && <span className="registration-test-confirm">{t("Ich verwende eine erfundene E-Mail-Adresse.")}</span>}
            </span>
          </label>
          {message && <p role="alert" className="error-banner">{message}</p>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t("Wird gespeichert …") : t("Anmeldung absenden")}
          </button>
        </form>
      </>}
      <footer><SurveyPrivacyDialog language={language} notice={privacy} testOnly={testOnly} /></footer>
    </main>
  </div>
  return <div className="shell" lang={language}><header className="topbar survey-topbar"><SurveyBrand language={language} branding={branding} homeURL={homeURL} navigationURL={navigationURL} /><div className="survey-tools"><span className="test-tag">{testOnly ? t("Arbeitsfassung · Pretest") : t("Erhebung")}</span></div></header><div className="layout"><aside className="sidebar"><p className="eyebrow">{t("Deine Rückmeldung")}</p><h2>{title}</h2><p className="side-intro">{t("Du kannst die Abschnitte der Reihe nach ausfüllen.")}</p><nav aria-label={t("Abschnitte")}><ol>{sectionIndexes.map((i, position) => { const s = sections[i]; return <li className={step === i ? 'active' : step > i ? 'done' : ''} key={s.id}><button disabled={step < 0 || busy || saved || i > step} onClick={() => go(i)}><span className="section-nav__number">{step > i ? '✓' : String(position + 1).padStart(2, '0')}</span><span className="section-nav__title">{s.title}</span></button></li> })}</ol></nav><p className="side-note">Payload Forms · {testOnly ? t("Pretest mit Testdaten") : t("Teilnahme")}</p></aside><main>
    {saved ? <section className="success"><div className="success-mark">✓</div><p className="eyebrow">{testOnly ? t("Test abgeschlossen") : t("Teilnahme abgeschlossen")}</p><h1 tabIndex={-1} ref={heading}>{testOnly ? t("Danke fürs Ausprobieren.") : t("Danke für deine Teilnahme.")}</h1><p>{testOnly ? t("Deine Testantwort wurde gespeichert. Sie bleibt als Testdatensatz gekennzeichnet.") : t("Deine Antwort wurde gespeichert.")}</p>{definition.thankYouContent && <SurveyContent language={language} blocks={[{ blockType: 'text', content: definition.thankYouContent }]} homeURL={homeURL} />}{testOnly && <p className="help">{t("Für den Pretest interessieren uns Verständnis, Dauer und fehlende Angaben. Die Auswertung im Teamzugang ersetzt keine wissenschaftliche Prüfung.")}</p>}{!testOnly && !evaluationRun && <ParticipantShare language={language} title={title} homeURL={homeURL} />}<button className={testOnly ? "primary" : "clear"} onClick={() => { setSaved(false); go(-1) }}>{testOnly ? t("Neue Testantwort beginnen") : t("Neue Teilnahme beginnen")}</button></section> : step < 0 ? <section className="intro"><p className="eyebrow">{testOnly ? t("Fragebogen · Pretest") : t("Fragebogen · Teilnahme")}</p><h1 tabIndex={-1} ref={heading}>{title}</h1><button type="button" className="primary intro-start" onClick={begin}>{testOnly ? t("Fragebogen ausprobieren") : t("Fragebogen beginnen")} <span aria-hidden="true">→</span></button><div className="intro-meta"><span>{blocks} {blocks === 1 ? t("Frageblock") : t("Frageblöcke")}</span><span>{sections.length} {sections.length === 1 ? t("Abschnitt") : t("Abschnitte")}</span></div>{definition.introduction.map((p, i) => <p key={i}>{p}</p>)}<SurveyContent language={language} blocks={definition.introContent} homeURL={homeURL} />{testOnly ? <div className="notice"><strong>{t("Dies ist eine Testversion.")}</strong><p>{t("Bitte verwende ausschließlich erfundene Angaben. Dieses Formular ist für einen Pretest freigegeben.")}</p></div> : <div className="notice"><strong>{t("Teilnahme an einer Erhebung")}</strong><p>{t("Bitte lies die Datenschutzinformation vor deiner Teilnahme. Deine Angaben werden beim Absenden gespeichert und sind dem berechtigten Team zugänglich.")}</p></div>}{privacy && <details className="privacy-summary"><summary>{t("Datenschutz und Teilnahme")} · {privacy.version}</summary><PrivacyNotice language={language} notice={privacy} draft={testOnly} /></details>}{privacy?.contactMode === 'required' && <p className="help">{testOnly ? t("Diese Fassung benötigt Name und E-Mail für individuelle Rückmeldungen.") : t("Diese Fassung benötigt eine E-Mail-Adresse für individuelle Rückmeldungen. Dein Name ist freiwillig.")} {testOnly && t("Im Pretest bitte ausschließlich erfundene Angaben verwenden.")}</p>}<p className="help">{introHelp}</p><button type="button" className="primary" onClick={begin}>{testOnly ? t("Fragebogen ausprobieren") : t("Fragebogen beginnen")} <span aria-hidden="true">→</span></button></section> : <>
      <div className="section-head"><p className="eyebrow">{review ? t("Vor dem Speichern") : t("Abschnitt {0} von {1}", progress + 1, sectionIndexes.length)}</p><h1 tabIndex={-1} ref={heading}>{review ? t("Angaben prüfen & abschließen") : sections[step].title}</h1><div className="progress" role="progressbar" aria-label={t("Abschnittsfortschritt")} aria-valuemin={0} aria-valuemax={sectionIndexes.length} aria-valuenow={progress}><span style={{ width: `${sectionIndexes.length ? progress / sectionIndexes.length * 100 : 0}%` }} /></div>{!review && sections[step].description && <p>{sections[step].description}</p>}</div>
      {message && <p role="alert" className="error-banner">{message}</p>}
      {review ? <section className="review"><p>{t("Du hast Angaben zu {0} von {1} eingeblendeten Teilfragen gemacht. Einzelne Zeilen können noch leer sein. Unbeantwortete Angaben bleiben als fehlend erkennbar.", completed, applicable.length)}</p>{sectionIndexes.map(i => { const s = sections[i]; return <div className="review-row" key={s.id}><div><strong>{s.title}</strong><span>{t("{0} Teilfragen mit Angaben", s.questions.filter(q => visible(q, answers) && hasAnswer(answers[q.id])).length)}</span></div><button className="clear" onClick={() => go(i)}>{t("Prüfen")}</button></div> })}{privacy && <><details className="privacy-summary"><summary>{t("Datenschutzinformation erneut ansehen")}</summary><PrivacyNotice language={language} notice={privacy} draft={testOnly} /></details><ParticipantPrivacy language={language} notice={privacy} consent={consent} onConsentChange={setConsent} contactConsent={contactConsent} onContactConsentChange={setContactConsent} contact={contact} onContactChange={setContact} disabled={busy} testOnly={testOnly} /></>}<label className="test-confirm"><input type="checkbox" disabled={busy} checked={confirm} onChange={e => setConfirm(e.target.checked)} />{testOnly ? t("Ich habe nur Testdaten eingegeben und möchte diese Testantwort speichern.") : t("Ich möchte an dieser Erhebung teilnehmen und meine Antwort absenden.")}</label>{testOnly && <p className="help">{t("Diese Bestätigung ist keine Forschungseinwilligung.")} {privacy?.contactMode && privacy.contactMode !== 'none' ? t("Kontaktangaben und Zustimmungen werden hier ausschließlich mit Testdaten erprobt.") : t("Kontaktdaten für ein Folgegespräch werden erst in der freigegebenen Erhebung getrennt erfasst.")}</p>}<div className="actions"><button className="secondary" disabled={busy} onClick={() => go(previousStep)}>{t("Zurück")}</button><button className="primary" disabled={!confirm || busy || (privacy?.legalBasis === 'consent' && !consent) || (privacy?.contactMode === 'required' && !contactConsent)} onClick={submit}>{busy ? t("Wird gespeichert …") : testOnly ? t("Testantwort speichern") : t("Antwort absenden")}</button></div></section> : <><div className="fields"><SurveyContent language={language} blocks={sections[step].content?.filter(block => !block.afterQuestion)} homeURL={homeURL} />{sections[step].questions.map(q => <Fragment key={q.id}>{visible(q, answers) && <Field language={language} q={q} hideQuestionCodes={hideQuestionCodes} value={answers[q.id]} error={errors[q.id]} onChange={value => setAnswers(prev => { const next = { ...prev }; if (value === undefined) delete next[q.id]; else next[q.id] = value; return next })} />}<SurveyContent language={language} blocks={sections[step].content?.filter(block => block.afterQuestion === q.id)} homeURL={homeURL} /></Fragment>)}</div><div className="actions"><button className="secondary" disabled={busy} onClick={() => go(previousStep)}>{t("Zurück")}</button><button className="primary" onClick={next}>{isLastSection ? t("Angaben prüfen") : t("Weiter")} <span aria-hidden="true">→</span></button></div></>}
    </>}
    <footer><SurveyPrivacyDialog language={language} notice={privacy} testOnly={testOnly} /><span>Payload Forms · {definition.version}</span><span>{t("Bitte keine Namen anderer Personen oder vertraulichen Inhalte eingeben.")}</span></footer>
  </main></div></div>
}
