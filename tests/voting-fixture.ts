import type { Definition } from '../src/survey/types'

export const votingDefinition: Definition = {
  version: 'voting-fixture-1', introduction: ['Ausschließlich erfundene Testangaben.'],
  sections: [{ id: 'feedback', title: 'Bewertung und Prioritäten', questions: [
    { id: 'Slider', block: 'Feedback', label: 'Wie stark möchtest du dich einbringen?', kind: 'slider', lowLabel: 'Gar nicht', highLabel: 'Sehr stark' },
    { id: 'Wide', block: 'Feedback', label: 'Wie weit sind wir?', kind: 'slider', min: 0, max: 100, step: 10, lowLabel: 'Am Anfang', highLabel: 'Am Ziel' },
    { id: 'Stars', block: 'Feedback', label: 'Wie hilfreich war das Treffen?', kind: 'stars', lowLabel: 'Kaum hilfreich', highLabel: 'Sehr hilfreich' },
    { id: 'Mood', block: 'Feedback', label: 'Wie zufrieden bist du mit der Zusammenarbeit?', kind: 'smiley' },
    { id: 'Rank', block: 'Prioritäten', label: 'Was sollten wir zuerst verbessern?', kind: 'ranking', options: [
      { value: 'clarity', label: 'Klarere Aufgaben und Verantwortlichkeiten' },
      { value: 'exchange', label: 'Mehr Zeit für Austausch im Team' },
      { value: 'decisions', label: 'Nachvollziehbare gemeinsame Entscheidungen' },
    ] },
  ] }],
}
