import { isTeamUser } from '@/auth/team'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import config from '@payload-config'
import { answerText } from '@/survey/answer-text'
import { visible } from '@/survey/validation'
import type { Answers, Definition } from '@/survey/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Einsendung · Payload Forms', referrer: 'no-referrer' as const, robots: { index: false, follow: false } }
export default async function ResponsePage({ params }: { params: Promise<{ reference: string }> }) {
  const parsed = z.string().uuid().safeParse((await params).reference)
  if (!parsed.success) notFound()
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: await headers() })
  if (!isTeamUser(user)) redirect(`/admin/login?redirect=${encodeURIComponent(`/antwort/${parsed.data}`)}`)
  // Materialize the response by its permanent reference in one read. A deleted
  // response cannot resolve to another submission after integer-ID reuse.
  const found = await payload.find({ collection: 'responses', where: { notificationReference: { equals: parsed.data } },
    depth: 0, limit: 1, user, overrideAccess: false })
  const response = found.docs[0]
  if (!response) notFound()
  const instrument = response.instrument as Definition, answers = response.answers as Answers
  return <main className="response-detail">
    <p className="eyebrow">Payload Forms · Teamzugang</p><h1>{response.testOnly ? 'Testeinsendung' : 'Einsendung'}</h1>
    <p>Fragebogenfassung: {response.version}</p>
    <p>Eingegangen: {new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna' }).format(new Date(response.createdAt))}</p>
    {response.testOnly && <p className="help">Diese Einsendung enthält ausschließlich Testangaben.</p>}
    {instrument.sections.map((section, index) => <details key={section.id} open={index === 0}>
      <summary>{section.title}</summary><dl>{section.questions.filter(question => visible(question, answers)).map(question => <div key={question.id}>
        <dt>{question.label}</dt><dd>{answerText(question, answers[question.id])}</dd>
      </div>)}</dl>
    </details>)}
    <p><a href="/admin/collections/responses">Antworten im Teamzugang verwalten</a></p>
  </main>
}
