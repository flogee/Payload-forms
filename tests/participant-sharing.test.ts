import test from 'node:test'
import assert from 'node:assert/strict'
import { participantShareURL } from '../src/survey/participant-sharing'

test('invitation links contain only the public path on the current origin', () => {
  assert.equal(participantShareURL('https://forms.example.org', '/f/sample?run=fixture&access=secret#response'), 'https://forms.example.org/f/sample')
  assert.equal(participantShareURL('http://127.0.0.1:3212', '/f/sample'), 'http://127.0.0.1:3212/f/sample')
  for (const path of ['https://other.example.org/f/sample', '//other.example.org/f/sample', '/antwort/private-reference', '/admin', '/f/sample/images/1']) {
    assert.equal(participantShareURL('https://forms.example.org', path), undefined)
  }
  assert.equal(participantShareURL('file:///tmp/', '/f/sample'), undefined)
})
