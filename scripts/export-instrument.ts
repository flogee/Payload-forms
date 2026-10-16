import { mkdirSync, writeFileSync } from 'node:fs'
import { sample } from '../src/survey/sample'
import { definitionSchema } from '../src/survey/validation'
definitionSchema.parse(sample)
mkdirSync('artifacts', { recursive: true })
writeFileSync(`artifacts/${sample.version}.json`, JSON.stringify(sample, null, 2) + '\n')
writeFileSync(`artifacts/${sample.version}-codebook.json`, JSON.stringify({
  version: sample.version,
  missing: { absent: 'Übersprungen; keine Angabe', unknown: 'Weiß nicht; eigener Status oder explizite Antwortoption', na: 'Nicht zutreffend; eigener Status oder explizite Antwortoption', zero: 'Zahl 0 bei status=value' },
  questions: sample.sections.flatMap(section => section.questions.map(q => ({ section: section.id, ...q })))
}, null, 2) + '\n')
console.log('Fragebogenschema und Codebuch unter artifacts/ gespeichert.')
