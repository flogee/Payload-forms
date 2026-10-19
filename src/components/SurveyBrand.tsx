'use client'

import { useEffect, useRef, useState } from 'react'
import type { SurveyBranding } from '@/survey/branding'
import './SurveyBrand.css'

export function SurveyBrand({ branding, homeURL, navigationURL = homeURL }: { branding: SurveyBranding; homeURL: string; navigationURL?: string }) {
  const [failedSource, setFailedSource] = useState<string>()
  const image = useRef<HTMLImageElement>(null)
  const source = branding.mode === 'logo' && /^\/f\/[a-z][a-z0-9-]{0,79}$/.test(homeURL)
    ? `${homeURL}/images/${branding.logo}` : undefined
  useEffect(() => {
    // An eager SSR image can fail before hydration attaches onError.
    if (source && image.current?.complete && image.current.naturalWidth === 0) setFailedSource(source)
  }, [source])
  if (branding.mode === 'default') return <a className="wordmark" href={navigationURL} aria-label="Fragebogen Startseite">
    Payload Forms<span>Befragungen</span>
  </a>
  return <a className="survey-brand" href={navigationURL} aria-label={`${branding.text} · Fragebogen Startseite`}>
    {source && source !== failedSource
      ? <img ref={image} className="survey-brand__logo" src={source} alt={branding.text} decoding="async" onError={() => setFailedSource(source)} />
      : <strong className="survey-brand__text">{branding.text}</strong>}
  </a>
}
