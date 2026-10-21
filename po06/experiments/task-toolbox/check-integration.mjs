// Fresh-process integration replay of the production hooks with actual subprocess output.
// Session event envelopes below are harness-generated; this is not a live DSH session experiment.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adapter as productionAdapter } from '../../lib/index.js'
import { createCapability } from '../../lib/capability.js'
import { createTaskToolboxStore } from '../../lib/toolbox-state.js'
import { createState } from '../../lib/schema.js'
import { reduce, recordUserInput } from '../../lib/reducer.js'
const here=dirname(fileURLToPath(import.meta.url)),project=resolve(process.argv[2]||'.po06-tmp/toolbox-three-trial'),workspace=resolve('.'),indexHome=resolve(project,'index-trial')
const a=new productionAdapter.constructor();a.capability=createCapability();a.toolboxStore=createTaskToolboxStore({home:indexHome,namespace:'real-subprocess'});a.policyNow=()=>({toolboxMode:'auto',advisor:false});a.services.agents={get:()=>({})}
const states=new Map(),s={id:'controlled-three-toolbox',header:{cwd:workspace}}
a.intentStateOf=s=>states.get(s.id)||null
a.initIntent=(s,{taskId})=>{const state=createState({sessionId:s.id,taskId});states.set(s.id,state);return {ok:true,state}}
a.commitUserInput=(s,p)=>{const state=recordUserInput(states.get(s.id),p);states.set(s.id,state);return {ok:true,state}}
a.commit=(s,p)=>{const r=reduce(states.get(s.id),p);if(r.ok)states.set(s.id,r.state);return r}
const interpret=relation=>async()=>JSON.stringify({intent:{text:'Continue the controlled vehicle task',relation},add:[],clarify:[],ask:[],decide:[]})
await a.handleInput(s,{messageId:'first',text:'Controlled vehicle',policy:{toolboxMode:'auto'},interpret:interpret('new')})
const command='node '+resolve(here,'toolbox.mjs')+' inspect '+project
a.observeToolbox(s,{type:'tool/ptc-dispatch-start',seq:1,data:{subCallId:'observed-subprocess',name:'bash',arguments:JSON.stringify({command})}})
const executed=spawnSync(process.execPath,[resolve(here,'toolbox.mjs'),'inspect',project],{encoding:'utf8'})
if(executed.status!==0)throw Error(executed.stderr||executed.stdout)
const recorded=a.observeToolbox(s,{type:'tool/ptc-dispatch',seq:2,data:{subCallId:'observed-subprocess',content:[{type:'text',text:executed.stdout+'\n[exit code: '+executed.status+']'}]}})
if(!recorded.ok)throw Error(JSON.stringify(recorded))
const before=a.toolboxStore.status({sessionId:s.id}),taskId=before.taskId
await a.handleInput(s,{messageId:'follow-up',text:'Continue refinements',policy:{toolboxMode:'auto'},interpret:interpret('continue')})
const summary=await a.toolboxContextFor(s)
if(summary.taskTools.length!==1||!a.getWorkingText(s.id).includes('toolbox.mjs'))throw Error('tool facts failed to reach both contexts')
const restored=createTaskToolboxStore({home:indexHome,namespace:'real-subprocess'}),after=restored.status({sessionId:s.id})
if(after.taskId!==taskId||after.entries[0].currentAvailability!=='unknown')throw Error('restart identity or availability mismatch')
const record={kind:'controlled-integration',source:'actual CLI stdout; harness-generated session envelopes; fixed interpreter output (not a model behavior evaluation)',
 entrypoint:resolve(here,'toolbox.mjs'),taskId,callId:recorded.record.callId,reportedArtifactVersion:recorded.record.reportedArtifactVersion,
 scope:before.workspace,status:recorded.record.status,optimizerToolFacts:summary.taskTools.length,workingContextContainsEntry:true,
 restart:{sameTask:after.taskId===taskId,entries:after.entries.length,currentAvailability:after.entries[0].currentAvailability},
 measurements:JSON.parse(executed.stdout.trim()).taskToolbox.measurements}
writeFileSync(resolve(project,'integration-result.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record))
