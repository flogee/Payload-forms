import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { accessSettings, accessStrategy } from '../src/auth/access'
import { configureUsers, staff } from '../src/collections/Users'
import { isTeamUser, managesTeam } from '../src/auth/team'
const env = { ACCESS_LOGIN_ENABLED: '1', ACCESS_TEAM_DOMAIN: 'https://fixture.cloudflareaccess.com', ACCESS_AUD: 'a'.repeat(64) }
const keys = await generateKeyPair('RS256'), second = await generateKeyPair('RS256')
const key = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'fixture', alg: 'RS256' }] })
async function assertion(changes: Record<string, unknown> = {}, signingKey = keys.privateKey) {
  const now = Math.floor(Date.now()/1000)
  return new SignJWT({ email: 'TEAM@example.invalid', type: 'app', sub: 'fixture-sub', iat: now, exp: now+300,
    iss: env.ACCESS_TEAM_DOMAIN, aud: [env.ACCESS_AUD], ...changes }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(signingKey)
}
async function authenticate(token?: string, user: any = { id: 1, email: 'team@example.invalid', enabled: true, role: 'editor' }) {
  const calls: any[] = [], headers = new Headers({ 'cf-access-authenticated-user-email': 'admin@example.invalid' })
  if (token) headers.set('cf-access-jwt-assertion', token)
  const result = await accessStrategy(env, key).authenticate({ headers, req: {}, payload: { find: async (options: any) => {
    calls.push(options); return { docs: user ? [user] : [] }
  } } } as any)
  return { result, calls }
}
test('Access is opt-in, validates its fixed issuer/audience, retains stored local password fields', () => {
  assert.equal(accessSettings({}), null)
  assert.throws(() => accessSettings({ ...env, ACCESS_TEAM_DOMAIN: 'http://localhost:9999' }))
  assert.throws(() => accessSettings({ ...env, ACCESS_AUD: '' }))
  const config = configureUsers(env)
  assert.deepEqual((config.auth as any).disableLocalStrategy, { enableFields: true })
  assert.equal(configureUsers({}).auth, true)
})
test('a verified human assertion maps only to an existing active team account, without creating users', async () => {
  const { result, calls } = await authenticate(await assertion())
  assert.equal(result.user?.collection, 'users'); assert.equal(result.user?._strategy, 'cloudflare-access')
  assert.deepEqual(calls[0].where, { email: { equals: 'team@example.invalid' }, enabled: { equals: true } })
  assert.equal(calls[0].depth, 0); assert.equal(calls[0].limit, 1)
  assert.equal((await authenticate(await assertion(), null)).result.user, null)
  assert.equal((await authenticate(await assertion(), { id:1, enabled:false })).result.user, null)
})
test('missing, forged, wrong audience/issuer, expired and non-human assertions never reach the database', async () => {
  const tokens = [undefined, 'forged', await assertion({}, second.privateKey), await assertion({ aud: ['b'.repeat(64)] }),
    await assertion({ iss: 'https://other.cloudflareaccess.com' }), await assertion({ exp: 1 }), await assertion({ type:'org' }),
    await assertion({ non_identity:true }), await assertion({ sub:'' }), await assertion({ email:'' }), 'x'.repeat(16385)]
  for (const token of tokens) { const { result, calls } = await authenticate(token); assert.equal(result.user, null); assert.equal(calls.length, 0) }
})
test('disabled users and MCP keys cannot administer team accounts; editors retain form access', () => {
  const user = { id:1, collection:'users', role:'admin', enabled:true }
  assert.equal(managesTeam(user), true)
  assert.equal(managesTeam({ ...user, role:'editor' }), false)
  assert.equal(managesTeam({ ...user, _strategy:'mcp-api-key' }), false)
  assert.equal(isTeamUser({ ...user, enabled:false }), false)
  assert.equal(isTeamUser({ ...user, enabled:null }), false)
  assert.equal(staff({req:{user:{ ...user, enabled:false }} as any}), false)
  assert.equal(isTeamUser({ ...user, role:'editor' }), true)
  const hook = configureUsers({}).hooks!.beforeChange![0] as any
  for (const data of [{enabled:false},{enabled:null},{role:'editor'},{email:'other@example.invalid'}]) assert.throws(()=>hook({ data, originalDoc:{id:1,email:'team@example.invalid'},operation:'update',req:{user} }))
})

test('existing local cookies do not start a second Payload session or expiration timer in Access mode',async()=>{
  const config=configureUsers(env),user={id:1,collection:'users',enabled:true,role:'admin',_strategy:'cloudflare-access'}
  const me=await (config.hooks!.me![0] as any)({user});assert.deepEqual(me,{user,exp:undefined});assert.equal(me.exp,undefined)
  const refresh=await (config.endpoints as any[])[0].handler({user});assert.equal(refresh.status,200)
  const body=await refresh.json();assert.equal(body.user.id,1);assert.equal(body.exp,undefined);assert.equal(body.token,undefined)
  assert.equal(refresh.headers.has('set-cookie'),false)
})
