import test from 'node:test'
import assert from 'node:assert/strict'
import { internalHostnames } from '../scripts/check-access.mjs'
import { participationPaths, privatePaths, verifyReleaseHosts } from '../scripts/check-release-hosts.mjs'

const dnsError = () => new TypeError('fetch failed', { cause: Object.assign(new Error('DNS pending'), { code: 'ENOTFOUND' }) })

test('release checks every protected path on both domains after a transient DNS failure', async () => {
  const urls: string[] = []
  const waits: number[] = []
  let elapsed = 0
  await verifyReleaseHosts({
    now: () => elapsed,
    wait: async (ms: number) => { waits.push(ms); elapsed += ms },
    onRetry: () => {},
    request: async (url: string, options: RequestInit) => {
      urls.push(url)
      assert.equal(options.redirect, 'manual')
      if (urls.length === 1) throw dnsError()
      return new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } })
    },
  })
  assert.deepEqual(waits, [5000])
  assert.deepEqual(urls.slice(1), internalHostnames.flatMap(host => [...privatePaths, ...participationPaths].map(path => `https://${host}${path}`)))
})

test('release fails immediately for public responses, unrelated redirects and invalid TLS', async () => {
  for (const result of [
    new Response(null, { status: 200 }),
    new Response(null, { status: 302, headers: { location: 'https://example.org/login' } }),
    new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com.example.org/login' } }),
    new TypeError('fetch failed', { cause: Object.assign(new Error('Invalid certificate'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }) }),
  ]) {
    let calls = 0
    await assert.rejects(verifyReleaseHosts({
      request: async () => { calls++; if (result instanceof Error) throw result; return result },
      wait: async () => { assert.fail('Unsafe responses must never be retried.') },
    }))
    assert.equal(calls, 1)
  }
})

test('release stops when DNS stays unavailable instead of passing or waiting indefinitely', async () => {
  let elapsed = 0
  let calls = 0
  await assert.rejects(verifyReleaseHosts({
    timeoutMs: 15000,
    now: () => elapsed,
    wait: async (ms: number) => { elapsed += ms },
    onRetry: () => {},
    request: async () => { calls++; throw dnsError() },
  }), /fetch failed/)
  assert.equal(calls, 3)
  assert.equal(elapsed, 10000)
})

test('release requires the configured team domain after an authentication-domain change', async () => {
  const teamDomain = 'https://team.cloudflareaccess.com'
  await assert.rejects(verifyReleaseHosts({ teamDomain,
    request: async () => new Response(null, { status: 302, headers: { location: 'https://previous-team.cloudflareaccess.com/login' } }),
  }), /Access blockiert/)
  await verifyReleaseHosts({ teamDomain,
    request: async () => new Response(null, { status: 302, headers: { location: `${teamDomain}/cdn-cgi/access/login` } }),
  })
})

function publicResponse(url: string, options: RequestInit) {
  const parsed = new URL(url)
  if (privatePaths.includes(parsed.pathname + parsed.search)) return new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/login' } })
  if (parsed.pathname === '/f/sample') return new Response('<html><link href="/_next/static/style.css" rel="stylesheet"><script src="/_next/static/app.js"></script></html>', { headers: { 'content-type': 'text/html' } })
  if (parsed.pathname.startsWith('/_next/static/')) return new Response('fixture asset', { headers: { 'content-type': parsed.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' } })
  if (parsed.pathname === '/api/survey/submit') {
    assert.equal(options.method, 'POST')
    assert.equal((options.headers as Record<string, string>).Origin, parsed.origin)
    assert.equal(options.body, '{')
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  return new Response(null, { status: 404 })
}

test('public release verifies HTML, real static assets, safe invalid submission and protected private paths on both hosts', async () => {
  const urls: string[] = []
  let elapsed = 0
  await verifyReleaseHosts({ publicParticipation: true, now: () => elapsed, wait: async ms => { elapsed += ms }, onRetry: () => {},
    request: async (url, options) => {
      urls.push(url)
      if (url.endsWith('/_next/static/style.css') && elapsed === 0) throw dnsError()
      return publicResponse(url, options)
    } })
  for (const host of internalHostnames) {
    for (const path of [...privatePaths, '/f/sample', '/_next/static/app.js', '/_next/static/style.css',
      '/f/nonexistent', '/f/sample/images/2147483647', '/datenschutz/nonexistent', '/api/survey/submit']) assert.ok(urls.includes(`https://${host}${path}`), path)
  }
  assert.equal(elapsed, 5000)
})

test('public release rejects exposed private paths, protected public paths, missing assets and false success statuses', async () => {
  for (const [path, response] of [
    ['/api/responses', new Response(null, { status: 200 })],
    ['/f/sample', new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/login' } })],
    ['/f/sample', new Response('<html>No assets</html>', { headers: { 'content-type': 'text/html' } })],
    ['/_next/static/app.js', new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } })],
    ['/f/nonexistent', new Response(null, { status: 200 })],
    ['/datenschutz/nonexistent', new Response(null, { status: 200 })],
    ['/f/sample/images/2147483647', new Response(null, { status: 200 })],
    ['/api/survey/submit', new Response(null, { status: 201 })],
  ] as const) await assert.rejects(verifyReleaseHosts({ publicParticipation: true,
    request: async (url, options) => new URL(url).pathname === path ? response : publicResponse(url, options),
    wait: async () => assert.fail('HTTP failures must never be retried.') }))
})

test('release probes use only installer-selected hosts and the configured pretest slug', async () => {
  const urls: string[] = []
  await verifyReleaseHosts({ hostnames: ['forms.fixture.dev'], probeSlug: 'own-pretest', publicParticipation: true,
    request: async (url, options) => { urls.push(url); return publicResponse(url.replace('/f/own-pretest', '/f/sample'), options) } })
  assert.ok(urls.includes('https://forms.fixture.dev/f/own-pretest'))
  assert.equal(urls.every(url => new URL(url).hostname === 'forms.fixture.dev'), true)
  await assert.rejects(verifyReleaseHosts({ probeSlug: '../admin' }))
})
