import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
export async function createHarness(root, options={}) {
const require=createRequire(`${root}/package.json`);
const load=name=>import(pathToFileURL(require.resolve(name)).href);
const {buildConfig,getPayload}=await load('payload');
const {sqliteD1Adapter}=await load('@payloadcms/db-d1-sqlite');
const {Surveys}=await import(pathToFileURL(`${root}/src/collections/Surveys.ts`).href);
const {configureUsers}=await import(pathToFileURL(`${root}/src/collections/Users.ts`).href);
const {preserveUnchangedSurveyArrays}=await import(pathToFileURL(`${root}/src/survey/persist-update.ts`).href);
const {toStored,fromStored}=await import(pathToFileURL(`${root}/src/survey/storage.ts`).href);
const {sample: fixture}=await import(pathToFileURL(`${root}/src/survey/sample.ts`).href);
const latestSnapshot=readdirSync(`${root}/src/migrations`).filter(name=>/^\d{8}_\d{6}_.*\.json$/.test(name)).sort().at(-1);
if(!latestSnapshot)throw new Error('No migration schema snapshot');
const snapshot=JSON.parse(readFileSync(`${root}/src/migrations/${latestSnapshot}`));
const native=new DatabaseSync(':memory:');
native.exec('PRAGMA foreign_keys=ON');
const quote=n=>`"${n}"`;
for(const t of Object.values(snapshot.tables)) {
 const cols=Object.values(t.columns).map(c=>`${quote(c.name)} ${c.type}${c.primaryKey?' PRIMARY KEY':''}${c.notNull?' NOT NULL':''}${c.default!==undefined?' DEFAULT '+(typeof c.default==='boolean'?Number(c.default):c.default):''}`);
 const fks=Object.values(t.foreignKeys).map(f=>`FOREIGN KEY (${f.columnsFrom.map(quote)}) REFERENCES ${quote(f.tableTo)} (${f.columnsTo.map(quote)}) ON DELETE ${f.onDelete}`);
 native.exec(`CREATE TABLE ${quote(t.name)} (${[...cols,...fks].join(',')})`);
 for(const ix of Object.values(t.indexes)) native.exec(`CREATE ${ix.isUnique?'UNIQUE ':''}INDEX ${quote(ix.name)} ON ${quote(t.name)} (${ix.columns.map(quote)})`);
}
let events=[],batches=0;
const binding={prepare(sql) {
 const stmt=native.prepare(sql);
 const bound=params=>({
  async raw(){events.push({sql,params:params.length,mode:'raw'});stmt.setReturnArrays(true);return stmt.all(...params)},
  async all(){events.push({sql,params:params.length,mode:'all'});stmt.setReturnArrays(false);return {results:stmt.all(...params),success:true,meta:{}}},
  async run(){events.push({sql,params:params.length,mode:'run'});const info=stmt.run(...params);return {results:[],success:true,meta:{last_row_id:Number(info.lastInsertRowid),rows_written:Number(info.changes)}}},
 });
 return {...bound([]),bind:(...params)=>bound(params)};
},async batch(statements){batches++;return Promise.all(statements.map(s=>s.all()))}};
const database=sqliteD1Adapter({binding,push:false});
const originalInit=database.init;
database.init=args=>{const adapter=originalInit(args);adapter.updateOne=preserveUnchangedSurveyArrays(adapter.updateOne);return adapter;};
const config=await buildConfig({secret:randomBytes(32).toString('hex'),db:database,admin:{user:'users',disable:true},collections:[configureUsers(options.usersEnvironment || {}),options.surveyTransform ? options.surveyTransform(Surveys) : Surveys,{slug:'media',upload:{staticDir:'/private/tmp/payload-forms-test-unused-media'},fields:[{name:'title',type:'text'}]}],graphQL:{disable:true},typescript:{outputFile:'/private/tmp/payload-forms-test-unused-types.ts'}});
const payload=await getPayload({config,key:randomBytes(8).toString('hex')});
return {payload,native,fixture,toStored,fromStored,user:{id:777,collection:'users',role:'admin',enabled:true}, reset(){events=[];batches=0}, get events(){return events}, get batches(){return batches}, async close(){await payload.destroy();native.close()}};
}
