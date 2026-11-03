import test from 'node:test'
import assert from 'node:assert/strict'
import type { Payload } from 'payload'
import type { Definition } from '../src/survey/types'
import { exportCSV } from '../src/survey/csv'
import { loadAnalysis } from '../src/survey/analysis-load'
import { toStored } from '../src/survey/storage'

const before: Definition={version:'fixture-v1',introduction:[],sections:[{id:'s',title:'Original section',questions:[
  {id:'Removed',block:'1',label:'Original text',kind:'text'},
  {id:'Rank',block:'2',label:'Original ranking',kind:'ranking',options:[{value:'a',label:'A'},{value:'b',label:'B'}]},
]}]}
const after: Definition={version:'fixture-v2',introduction:[],sections:[{id:'s',title:'Revised section',questions:[{id:'New',block:'1',label:'New text',kind:'text'}]}]}
const user={id:9,collection:'users' as const,enabled:true,role:'admin' as const,email:'fixture@example.invalid',createdAt:'2026-11-03T00:00:00Z',updatedAt:'2026-11-03T00:00:00Z'}

test('CSV retains removed questions, old ranking codes and earlier versions through each response snapshot',()=>{
  const csv=exportCSV(after,[
    {id:1,version:before.version,createdAt:'',instrument:before,answers:{Removed:'Original answer',Rank:{order:['b','a']}}},
    {id:2,version:after.version,createdAt:'',instrument:after,answers:{New:'New answer'}},
  ])
  const lines=csv.split('\r\n')
  assert.match(lines[0],/instrument_revision/);assert.match(lines[0],/Removed/);assert.match(lines[0],/Rank_rank_1/)
  assert.match(lines[1],/fixture-v1/);assert.match(lines[1],/Original answer/);assert.match(lines[1],/"b","a"/)
  assert.match(lines[2],/fixture-v2/);assert.match(lines[2],/New answer/)
})

test('aggregate uses a single retained snapshot and explicitly rejects mixed pretest definitions',async()=>{
  let docs:any[]=[{instrument:before,answers:{Removed:'Fictional'},testOnly:true,createdAt:''}]
  const payload={find:async(args:any)=>args.collection==='surveys'
    ?{docs:[{id:1,title:'Mutable fixture',slug:'mutable-fixture',phase:'pretest',...toStored(after)}]}
    :{totalDocs:docs.length,docs}} as unknown as Payload
  const report=await loadAnalysis(payload,1,{user})
  assert.equal(report.survey.version,before.version)
  assert.equal(report.sections[0].title,'Original section')
  docs.push({instrument:after,answers:{New:'Fictional'},testOnly:true,createdAt:''})
  await assert.rejects(loadAnalysis(payload,1,{user}),(error:any)=>error.status===422&&/unterschiedlichen Fragebogenständen/.test(error.message))
})

test('CSV disambiguates generated and metadata column names without dropping any valid answer',()=>{
  const definition:Definition={version:'collision-v1',introduction:[],sections:[{id:'s',title:'Collision fixture',questions:[
    {id:'Q',block:'1',label:'Count',kind:'count'},
    {id:'Q_value',block:'2',label:'Text',kind:'text'},
    {id:'response_id',block:'3',label:'Another text',kind:'text'},
  ]}]}
  const csv=exportCSV(definition,[{id:7,version:definition.version,createdAt:'',instrument:definition,answers:{Q:{status:'value',value:42},Q_value:'hello',response_id:'retained'}}])
  const [header,row]=csv.split('\r\n')
  assert.match(header,/"Q_value"/);assert.match(header,/"Q_value__2"/);assert.match(header,/"response_id__2"/)
  assert.match(row,/"42"/);assert.match(row,/"hello"/);assert.match(row,/"retained"/)
})
