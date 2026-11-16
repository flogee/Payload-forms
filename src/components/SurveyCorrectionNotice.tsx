'use client'

import { useDocumentInfo } from '@payloadcms/ui'

export function SurveyCorrectionNotice() {
  const { id } = useDocumentInfo()
  return <div style={{ maxWidth: '70ch', marginBottom: 'var(--base)' }}>
    <p>Logo, Tippfehler und Formulierungen können hier korrigiert werden. Bestätige vor dem Speichern, dass die Bedeutung gleich bleibt, und gib einen kurzen Grund an.</p>
    <p>Der Teilnahmelink bleibt gleich. Bisherige Antworten behalten ihre ursprünglichen Texte. Fragen, Antwortwerte, Skalen und Sprungregeln können hier nicht ergänzt oder umgebaut werden.</p>
    {id != null && <a href={`/admin/collections/survey-corrections?where[survey][equals]=${encodeURIComponent(String(id))}`}>Bisherige Korrekturen ansehen</a>}
  </div>
}
