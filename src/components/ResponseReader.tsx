'use client'

import { Button, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { responseView } from '@/survey/response-view'
import { ResponseReport } from './ResponseReport'
import './ResponseReader.css'

export function ResponseReader() {
  const { id, data } = useDocumentInfo()
  const view = responseView({ ...data, id })
  const [printRoot, setPrintRoot] = useState<HTMLElement | null>(null)
  const [timeZone, setTimeZone] = useState('UTC')
  const available = !!view
  useEffect(() => {
    if (!available) return
    const root = document.createElement('div')
    root.className = 'response-print-root'
    document.body.appendChild(root)
    setPrintRoot(root)
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
    return () => { root.remove() }
  }, [available])

  if (!view) return <section className="response-reader" role="status">
    <h2>Einzelantwort</h2><p>Für diese Antwort ist keine lesbare Fragebogenfassung verfügbar. Die gespeicherten Angaben stehen unter „Technische Daten“.</p>
  </section>

  return <>
    <article className="response-reader" aria-label={`Lesbare Einzelansicht Antwort ${view.id}`}>
      <ResponseReport view={view} timeZone={timeZone} actions={<Button type="button" buttonStyle="secondary" size="small" onClick={() => window.print()} disabled={!printRoot}>
        Drucken / als PDF speichern
      </Button>} />
    </article>
    {printRoot && createPortal(<article className="response-reader response-reader--print"><ResponseReport view={view} timeZone={timeZone} /></article>, printRoot)}
  </>
}
