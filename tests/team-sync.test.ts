import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { migrations } from '../src/migrations'
import { reconcileTeamAccess, teamSnapshot, canonicalEmails, type TeamSyncEnvironment } from '../src/auth/team-sync'
import type { ResponseDatabase, SQLValue } from '../src/survey/response-store'
const env: TeamSyncEnvironment = { ACCESS_SYNC_ENABLED:'1', ACCESS_SYNC_TOKEN:'fixture-only-not-a-secret', ACCESS_ACCOUNT_ID:'a'.repeat(32),
  ACCESS_APP_ID:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ACCESS_POLICY_ID:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ACCESS_INITIAL_EMAILS:'first@example.invalid' }
const now = new Date('2026-10-09T11:00:00Z')
async function fixture() {
  const sqlite = new DatabaseSync(':memory:'), dialect = new SQLiteSyncDialect()
  for (const migration of migrations) await migration.up({ db: { run: async (statement:any)=>sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any)
  sqlite.exec("INSERT INTO users (id,email,role,enabled) VALUES (1,'first@example.invalid','admin',1)")
  const db:ResponseDatabase={ prepare(sql) { return { sql, values:[],bind(...values:SQLValue[]){return{sql,values,bind:this.bind}} } as any },
    async batch(statements) { sqlite.exec('BEGIN');try { const result=statements.map((s:any)=>({results:sqlite.prepare(s.sql).all(...s.values),meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get()!.n)}}));sqlite.exec('COMMIT');return result } catch(e){sqlite.exec('ROLLBACK');throw e} } }
  const calls:{method:string;url:string;body?:any}[]=[]
  let policy:any={id:env.ACCESS_POLICY_ID,name:'Fixture',decision:'allow',include:[{email:{email:'first@example.invalid'}}],require:[],exclude:[],app_count:1,session_duration:'12h'}
  const fetcher:typeof fetch=async(input,options)=>{
    const url=String(input),method=options?.method??'GET', body=options?.body?JSON.parse(String(options.body)):undefined
    calls.push({method,url,body})
    if(method==='PUT')policy={...policy,...body}
    return Response.json({success:true,result:url.includes('/apps/')?[{id:env.ACCESS_POLICY_ID}]:policy})
  }
  return {sqlite,db,calls,fetcher,policy:()=>policy,setPolicy:(p:any)=>{policy=p}}
}
test('team sync is opt-in and limits every managed list to 40 canonical unique emails', async()=>{
  assert.deepEqual(canonicalEmails([' A@example.invalid ','a@example.invalid']),['a@example.invalid'])
  for(const values of [[],['invalid'],Array.from({length:41},(_,i)=>`${i}@example.invalid`)])assert.throws(()=>canonicalEmails(values))
  const f=await fixture();try{await reconcileTeamAccess(f.db,{},f.fetcher,now);assert.equal(f.calls.length,0)}finally{f.sqlite.close()}
})
test('new members are reconciled once, settings retained, and disabled members are removed',async()=>{
  const f=await fixture();try{
    f.sqlite.exec("INSERT INTO users (id,email,enabled) VALUES(2,'second@example.invalid',1)")
    await Promise.all([reconcileTeamAccess(f.db,env,f.fetcher,now),reconcileTeamAccess(f.db,env,f.fetcher,now)])
    assert.equal(f.calls.filter(c=>c.method==='PUT').length,1)
    assert.equal(f.policy().session_duration,'12h');assert.equal((await teamSnapshot(f.db)).monitor!.status,'synced')
    await reconcileTeamAccess(f.db,env,f.fetcher,new Date(+now+300000));assert.equal(f.calls.length,4)
    f.sqlite.exec('UPDATE users SET enabled=0 WHERE id=2')
    await reconcileTeamAccess(f.db,env,f.fetcher,new Date(+now+600000))
    assert.deepEqual(f.policy().include,[{email:{email:'first@example.invalid'}}])
  }finally{f.sqlite.close()}
})
test('provider failures have three durable attempts, a five-minute cooldown and no unbounded retries',async()=>{
  const f=await fixture();let calls=0;const fail:typeof fetch=async()=>{calls++;return new Response('',{status:429})}
  try{
    for(let i=0;i<10;i++)await reconcileTeamAccess(f.db,env,fail,new Date(+now+i*300000))
    assert.equal(calls,3);assert.equal((await teamSnapshot(f.db)).monitor!.status,'failed')
    f.sqlite.exec("INSERT INTO users(id,email,enabled)VALUES(2,'new@example.invalid',1)")
    await reconcileTeamAccess(f.db,env,fail,new Date(+now+3600000));assert.equal(calls,4)
    await reconcileTeamAccess(f.db,env,fail,new Date(+now+3601000));assert.equal(calls,4)
  }finally{f.sqlite.close()}
})
test('unexpected rules, shared policies, outside edits and unknown assignments are never overwritten',async()=>{
  for(const change of [{app_count:2},{include:[{everyone:{}}]},{include:[{email:{email:'unknown@example.invalid'}}]},{require:[{email:{email:'first@example.invalid'}}]}]){
    const f=await fixture();try{
      f.setPolicy({...f.policy(),...change});await reconcileTeamAccess(f.db,env,f.fetcher,now)
      assert.equal(f.calls.some(c=>c.method==='PUT'),false);assert.equal((await teamSnapshot(f.db)).monitor!.status,'failed')
    }finally{f.sqlite.close()}
  }
})
test('additive migration preserves existing accounts, passwords and administrator capability',async()=>{
  const sqlite=new DatabaseSync(':memory:'),dialect=new SQLiteSyncDialect(),args={db:{run:async(s:any)=>sqlite.exec(dialect.sqlToQuery(s).sql)}} as any
  try{
    const index=migrations.findIndex(migration=>migration.name==='20261009_101528_team_access')
    assert.ok(index>=0)
    for(const migration of migrations.slice(0,index))await migration.up(args)
    sqlite.exec("INSERT INTO users(id,email,hash,salt)VALUES(1,'first@example.invalid','original-hash','original-salt')")
    await migrations[index].up(args)
    const user=sqlite.prepare('SELECT * FROM users').get()!;assert.equal(user.role,'admin');assert.equal(user.enabled,1);assert.equal(user.hash,'original-hash');assert.equal(user.salt,'original-salt')
    await assert.rejects(migrations[index].down(args),/Rückbau.*gesperrt/)
  }finally{sqlite.close()}
})

test('hourly verification detects external policy drift without API calls on every cron',async()=>{
  const f=await fixture();try{
    await reconcileTeamAccess(f.db,env,f.fetcher,now);assert.equal(f.calls.length,2)
    await reconcileTeamAccess(f.db,env,f.fetcher,new Date(+now+1800000));assert.equal(f.calls.length,2)
    f.setPolicy({...f.policy(),include:[{email:{email:'outside@example.invalid'}}]})
    await reconcileTeamAccess(f.db,env,f.fetcher,new Date(+now+3600000))
    assert.equal((await teamSnapshot(f.db)).monitor!.status,'failed');assert.equal(f.calls.some(c=>c.method==='PUT'),false)
  }finally{f.sqlite.close()}
})
test('an abandoned third lease is marked failed and cleared so the admin can retry',async()=>{
  const f=await fixture();try{
    const snapshot=await teamSnapshot(f.db)
    f.sqlite.prepare("INSERT INTO team_access_monitor(id,desired_digest,status,attempts,checked_at,lease_token,lease_until)VALUES(1,?,'syncing',3,?,'abandoned',?)")
      .run(snapshot.digest,new Date(+now-600000).toISOString(),new Date(+now-300000).toISOString())
    await reconcileTeamAccess(f.db,env,f.fetcher,now)
    const monitor=(await teamSnapshot(f.db)).monitor!;assert.equal(monitor.status,'failed');assert.equal(monitor.lease_token,null);assert.equal(f.calls.length,0)
    f.sqlite.exec("UPDATE team_access_monitor SET attempts=0,checked_at=NULL,status='pending' WHERE id=1 AND lease_token IS NULL")
    await reconcileTeamAccess(f.db,env,f.fetcher,now);assert.equal((await teamSnapshot(f.db)).monitor!.status,'synced')
  }finally{f.sqlite.close()}
})
test('a successful but unconfirmed write can recover even after the desired team list changes',async()=>{
  const f=await fixture();try{
    await reconcileTeamAccess(f.db,env,f.fetcher,now)
    f.sqlite.exec("INSERT INTO users(id,email,enabled)VALUES(2,'second@example.invalid',1)")
    let puts=0
    const uncertain:typeof fetch=async(input,options)=>{
      if(options?.method==='PUT')puts++
      if(puts===1 && options?.method==='GET' && !String(input).includes('/apps/'))return new Response('',{status:429})
      return f.fetcher(input,options)
    }
    await reconcileTeamAccess(f.db,env,uncertain,new Date(+now+300000));assert.equal((await teamSnapshot(f.db)).monitor!.status,'failed')
    assert.equal(f.policy().include.length,2)
    f.sqlite.exec("INSERT INTO users(id,email,enabled)VALUES(3,'third@example.invalid',1)")
    await reconcileTeamAccess(f.db,env,f.fetcher,new Date(+now+600000))
    assert.equal((await teamSnapshot(f.db)).monitor!.status,'synced');assert.equal(f.policy().include.length,3)
  }finally{f.sqlite.close()}
})

test('sync status distinguishes failures without forwarding provider bodies or unknown messages', async () => {
  const secretText = 'PRIVATE_PROVIDER_BODY_OR_CREDENTIAL'
  const cases: { change?: any; request?: typeof fetch; message: string }[] = [
    { change: { app_count: undefined }, message: 'Access-Richtliniennutzung ist nicht als genau eine Anwendung bestätigt.' },
    { change: { include: [{ everyone: {} }] }, message: 'Access-Richtlinie enthält ein unerwartetes Regelformat.' },
    { request: async () => { throw new Error(`Cloudflare-${secretText}`) }, message: 'Cloudflare-Abgleich konnte keine Verbindung aufbauen.' },
    { request: async () => { throw new DOMException(secretText, 'TimeoutError') }, message: 'Cloudflare-Abgleich hat das Zeitlimit erreicht.' },
    { request: async () => new Response(`<html>${secretText}</html>`), message: 'Cloudflare-Antwort enthält ungültige Abgleichdaten.' },
    { request: async () => new Response(secretText, { status: 403 }), message: 'Cloudflare-Abgleich fehlgeschlagen (HTTP 403).' },
  ]
  for (const scenario of cases) {
    const f = await fixture()
    try {
      if (scenario.change) f.setPolicy({ ...f.policy(), ...scenario.change })
      await reconcileTeamAccess(f.db, env, scenario.request ?? f.fetcher, now)
      const monitor = (await teamSnapshot(f.db)).monitor!
      assert.equal(monitor.status, 'failed')
      assert.equal(monitor.last_error, scenario.message)
      assert.equal(monitor.last_error.includes(secretText), false)
      assert.equal(f.calls.some(call => call.method === 'PUT'), false)
    } finally { f.sqlite.close() }
  }
})

test('tokens normalize surrounding whitespace and reject invalid header characters before any API call', async () => {
  for (const token of [undefined, 'bad\nembedded-token', 'x'.repeat(257)]) {
    const f = await fixture()
    try {
      await reconcileTeamAccess(f.db, { ...env, ACCESS_SYNC_TOKEN: token }, f.fetcher, now)
      const monitor = (await teamSnapshot(f.db)).monitor!
      assert.equal(monitor.status, 'failed')
      assert.match(monitor.last_error!, /Access-Abgleichschlüssel (fehlt|hat ein ungültiges Format)/)
      assert.equal(f.calls.length, 0)
    } finally { f.sqlite.close() }
  }
  const f = await fixture()
  try {
    await reconcileTeamAccess(f.db, { ...env, ACCESS_SYNC_TOKEN: ` ${env.ACCESS_SYNC_TOKEN}\n` }, async (input, options) => {
      assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${env.ACCESS_SYNC_TOKEN}`)
      return f.fetcher(input, options)
    }, now)
    assert.equal((await teamSnapshot(f.db)).monitor!.status, 'synced')
  } finally { f.sqlite.close() }
})
