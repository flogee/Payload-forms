import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { demoReport } from '../src/survey/analysis-demo'
import { forSharing } from '../src/survey/analysis'
import { analysisSVG } from '../src/survey/analysis-svg'

const report = demoReport(), shared = forSharing(report)
const destination = resolve(process.argv[2] ?? '.wrangler/analysis-demo')
await mkdir(destination, { recursive: true })
await writeFile(resolve(destination, 'berichtsdaten.json'), JSON.stringify(shared, null, 2) + '\n')
for (const section of report.sections) for (const series of section.series) {
  await writeFile(resolve(destination, `${series.id.replace(':', '-')}.svg`), analysisSVG(report, series))
}
const q1 = report.sections[0].series[0], q3 = report.sections[0].series[2]
const choice = q1.options.find(o => o.value === 'consent')!
await writeFile(resolve(destination, 'Beispielbericht.md'), `# Governance-Praxis – fiktiver Beispielbericht

Alle ${report.responses} Antworten sind erfunden. Fassung ${report.survey.version}, Datengrundlage 1.–3. Oktober 2026. Dies ist eine Demonstration der Software, kein Sample-Forschungsergebnis.

${choice.count} von ${q1.answered} Antworten (${choice.percent} %) nennen Konsent als Entscheidungsform. Das bezieht sich auf Einsendungen; daraus lässt sich keine Zahl unabhängiger Organisationen ableiten.

![Entscheidungsform](Q1.svg)

Die Anschlussfrage wurde ${q3.eligible} Antwortpersonen gezeigt. ${q3.answered} antworteten, ${q3.missing} ließen sie offen. ${q3.notAsked} wurden aufgrund der Sprungregel nicht gefragt. Die Anteile 40 %, 40 % und 20 % beziehen sich auf die 25 beantworteten Angaben.

![Überprüfung von Entscheidungen](Q3.svg)

Die Bewertungszeilen zeigen die vollständige Verteilung einschließlich „Kann ich nicht beurteilen“. Es wird weder ein Skalenmittelwert noch eine Gesamtnote berechnet.

![Nachvollziehbarkeit](Q4-clear.svg)

## Grenzen und Weiterverwendung

Freitextinhalte, Namen, Kontakte und individuelle Zahlen fehlen vollständig. JSON und das MCP-Werkzeug geben dieselben freigegebenen Verteilungen aus. Die seltene Antwort bei Q7 wird samt der gesamten Verteilung und deren Bezugsgrößen zurückgehalten. Interne SVG-Diagramme enthalten dagegen die für das Team sichtbaren Fallzahlen. Vor externer Weitergabe prüfen.

Die Mindestfallzahl fünf bietet keine Garantie für Anonymität. Auch wiederholte Auswertungen und Kontextwissen können Rückschlüsse erlauben. Die Software liefert deskriptive Zahlen; ChatGPT kann daraus einen Bericht formulieren, sollte keine Ursachen oder Repräsentativität behaupten.

Quellen: lokal erzeugtes Demo-Instrument und deterministische Demo-Antworten in src/survey/analysis-demo.ts. Maschinenlesbare Berichtsgrundlage: berichtsdaten.json. Reproduzieren: npm run export:analysis-demo.
`)
console.log(`Fiktiver Beispielbericht, Diagramme und MCP-Berichtsdaten: ${destination}`)
