import type { Definition } from './types'
import { analyze, type AnalysisRecord } from './analysis'

// Fictional data, never inserted into Payload or included in real survey counts.
export const demoDefinition: Definition = {
  version: 'demo-1', introduction: [], sections: [
    { id: 'praxis', title: 'Governance-Praxis', questions: [
      { id: 'Q1', block: '01', label: 'Welche Entscheidungsform wird genutzt?', kind: 'single', options: [{ value: 'consent', label: 'Konsent' }, { value: 'majority', label: 'Mehrheit' }, { value: 'mixed', label: 'Gemischte Verfahren' }] },
      { id: 'Q2', block: '02', label: 'Welche Praktiken werden eingesetzt?', kind: 'multiple', options: [{ value: 'roles', label: 'Klare Rollen' }, { value: 'rounds', label: 'Gesprächsrunden' }, { value: 'feedback', label: 'Regelmäßiges Feedback' }] },
      { id: 'Q3', block: '03', label: 'Wie häufig werden Konsententscheidungen überprüft?', kind: 'single', showIf: { field: 'Q1', values: ['consent'] }, options: [{ value: 'often', label: 'Regelmäßig' }, { value: 'sometimes', label: 'Gelegentlich' }, { value: 'never', label: 'Selten' }] },
    ] },
    { id: 'erleben', title: 'Zusammenarbeit erleben', questions: [
      { id: 'Q4', block: '04', label: 'Wie wird die Zusammenarbeit erlebt?', kind: 'matrix', rows: [{ key: 'clear', label: 'Entscheidungen sind nachvollziehbar' }, { key: 'heard', label: 'Meine Perspektive wird gehört' }], options: [
        { value: '1', label: 'Trifft nicht zu' }, { value: '2', label: 'Trifft eher nicht zu' }, { value: '3', label: 'Teils / teils' }, { value: '4', label: 'Trifft eher zu' }, { value: '5', label: 'Trifft zu' }, { value: 'unknown', label: 'Kann ich nicht beurteilen' },
      ] },
      { id: 'Q5', block: '05', label: 'Was hilft bei der Zusammenarbeit?', kind: 'textarea', optional: true },
    ] },
    { id: 'angaben', title: 'Angaben und Schutz kleiner Gruppen', questions: [
      { id: 'Q6', block: '06', label: 'Wie viele Treffen gab es?', kind: 'count', allowNA: true },
      { id: 'Q7', block: '07', label: 'Seltene Antwort – Beispiel für die Zurückhaltung im Export', kind: 'single', options: [{ value: 'yes', label: 'Ja' }, { value: 'no', label: 'Nein' }] },
    ] },
    { id: 'feedback', title: 'Bewertungen und Prioritäten', questions: [
      { id: 'Q8', block: '08', label: 'Wie gut passen die Abläufe?', kind: 'slider', min: 0, max: 100, step: 25, lowLabel: 'Gar nicht', highLabel: 'Sehr gut' },
      { id: 'Q9', block: '09', label: 'Wie hilfreich ist die Zusammenarbeit?', kind: 'stars', lowLabel: 'Wenig hilfreich', highLabel: 'Sehr hilfreich' },
      { id: 'Q10', block: '10', label: 'Wie zufrieden bist du?', kind: 'smiley', lowLabel: 'Sehr unzufrieden', highLabel: 'Sehr zufrieden' },
      { id: 'Q11', block: '11', label: 'Welche nächsten Schritte haben Vorrang?', kind: 'ranking', options: [
        { value: 'clarity', label: 'Rollen klären' }, { value: 'practice', label: 'Gemeinsam üben' }, { value: 'review', label: 'Abläufe überprüfen' },
      ] },
    ] },
  ],
}

export function demoRecords(): AnalysisRecord[] {
  const scales = ['1', '2', '2', '3', '3', '3', '4', '4', '4', '5', '5', 'unknown']
  return Array.from({ length: 60 }, (_, i) => ({ createdAt: `2026-10-0${1 + i % 3}T12:00:00.000Z`, answers: {
    Q1: { choice: i < 30 ? 'consent' : i < 50 ? 'majority' : 'mixed' },
    Q2: { choice: [...(i < 45 ? ['roles'] : []), ...(i % 2 === 0 ? ['rounds'] : []), ...(i % 4 === 0 ? ['feedback'] : [])] },
    ...(i < 25 ? { Q3: { choice: i < 10 ? 'often' : i < 20 ? 'sometimes' : 'never' } } : {}),
    Q4: { clear: scales[i % 12], heard: scales[(i + 3) % 12] },
    ...(i < 45 ? { Q5: 'Erfundener Demo-Freitext; wird nicht ausgegeben.' } : {}),
    Q6: i < 40 ? { status: 'value', value: i } : i < 50 ? { status: 'unknown' } : { status: 'na' },
    Q7: { choice: i === 0 ? 'no' : 'yes' },
    Q8: i % 5 * 25,
    Q9: i % 5 + 1,
    Q10: (i + 2) % 5 + 1,
    Q11: { order: Array.from({ length: 3 }, (_, position) => ['clarity', 'practice', 'review'][(i + position) % 3]) },
  } }))
}

export function demoReport() {
  const report = analyze(demoDefinition, demoRecords(), { id: 0, title: 'Governance-Praxis · fiktives Beispiel', slug: 'demo', version: demoDefinition.version, phase: 'demo' }, new Date('2026-10-09T12:00:00.000Z'))
  report.notes.unshift('Alle 60 Antworten sind vollständig erfunden. Kein Ergebnis des Sample-Forschungsfragebogens und keine Aussage über reale Personen oder Organisationen.')
  return report
}
