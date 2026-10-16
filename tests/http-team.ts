import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export async function checkTeamHTTP(base:string,token:string,adminID:number) {
  const auth={Authorization:`JWT ${token}`},request=(path:string,init?:RequestInit)=>fetch(base+path,init)
  const json=(path:string,data:unknown,headers:Record<string,string>=auth,method='POST')=>request(path,{method,headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(data)})
  const me=await (await request('/api/users/me',{headers:auth})).json() as any
  assert.equal(me.user.role,'admin');assert.equal(me.user.enabled,true)
  const anon=await request('/api/team-access/status');assert.equal(anon.status,403);await anon.body?.cancel()
  const status=await request('/api/team-access/status',{headers:auth});assert.equal(status.status,200);assert.match(status.headers.get('cache-control')||'',/no-store/);await status.body?.cancel()
  for(const data of [{enabled:false},{enabled:null},{role:'editor'}]){
    const response=await json(`/api/users/${adminID}`,data,auth,'PATCH');assert.ok([400,409].includes(response.status),'administrator cannot lock their own account');await response.body?.cancel()
  }
  const password=`fixture-${randomUUID()}`,email=`editor-${randomUUID()}@localhost.invalid`
  const created=await json('/api/users',{email,password,role:'editor',enabled:true,name:'Fixture editor'})
  assert.equal(created.status,201,'administrator creates a team member')
  const member=(await created.json() as any).doc
  const login=await json('/api/users/login',{email,password},{})
  assert.equal(login.status,200);const memberToken=(await login.json() as any).token,editor={Authorization:`JWT ${memberToken}`}
  const teamStatus=await request('/api/team-access/status',{headers:editor});assert.equal(teamStatus.status,403);await teamStatus.body?.cancel()
  const privilege=await json(`/api/users/${member.id}`,{role:'admin'},editor,'PATCH');assert.equal(privilege.status,403);await privilege.body?.cancel()
  const forbidden=await json('/api/users',{email:`forbidden-${randomUUID()}@localhost.invalid`,password,role:'admin',enabled:true},editor)
  assert.equal(forbidden.status,403);await forbidden.body?.cancel()
  const disabled=await json(`/api/users/${member.id}`,{enabled:false},auth,'PATCH');assert.equal(disabled.status,200);await disabled.body?.cancel()
  const exportResponse=await request('/api/survey/export',{headers:editor});assert.equal(exportResponse.status,401,'previous local JWT cannot access exports after disabling');await exportResponse.body?.cancel()
  const relogin=await json('/api/users/login',{email,password},{})
  assert.equal(relogin.status,403,'disabled local fixture cannot log in again');await relogin.body?.cancel()
  console.log('PASS: native team account creation, admin/editor authorization, self-lockout protection and immediate disabled-account export denial.')
}
