import test from 'node:test'
import assert from 'node:assert/strict'
import {createInferenceEvidenceContext} from '../lib/inference-context.js'
const human=(seq,id)=>({type:'user/message',seq,data:{id,role:'user',source:{kind:'user'},content:[{type:'text',text:'The actual task'}]}})
const request=id=>({sessionId:'s',messages:[{id,role:'user',source:{kind:'user'},content:[{type:'text',text:'The actual task'}]}]})
function fixture(){
 const seen=[],seeds=[],snapshots=[],clears=[];let settings={reasoningBoost:true,readTools:true}
 const events=[human(4,'m1')],session={id:'s',header:{cwd:'C:/work'},snapshotEvents:()=>events}
 const store={observe:(s,e,c)=>seen.push({session:s,event:e,context:c}),seed:(s,c)=>seeds.push({session:s,context:c}),snapshot:o=>{snapshots.push(o);return{version:1,requestId:o.requestId,openIssues:[{id:'E7',status:'reported-failure',excerpt:'FAIL spacing varies'}],recentEvidence:[],mode:'diagnose',limitations:[],completionClaimAllowed:false}},clear:sid=>clears.push(sid),status:()=>({count:1}),dispose:()=>seen.push('disposed')}
 const context=createInferenceEvidenceContext({store,getSession:sid=>sid==='s'?session:null,policy:()=>settings})
 return {context,events,session,seen,seeds,snapshots,clears,settings:set=>settings=set}
}
test('the exact real human request receives same-task observations through a read-only existing session',()=>{
 const f=fixture(),value=f.context.evidenceFor(request('m1'))
 assert.equal(value.mode,'diagnose');assert.equal(value.completionClaimAllowed,false)
 assert.deepEqual(f.snapshots[0],{sessionId:'s',requestId:'human:4',root:'C:/work',readEnabled:true})
 assert.equal(f.seeds.length,1);f.context.evidenceFor(request('m1'));assert.equal(f.seeds.length,1,'do not repeatedly backfill history')
})
test('old turn, unrelated user, plugin message and missing identity cannot inherit current evidence',()=>{
 const f=fixture()
 for(const options of [request('other'),{...request('m1'),sessionId:'different'},{...request('m1'),messages:[{...request('m1').messages[0],source:{kind:'plugin:fake'}}]},request(undefined)]){
  const out=f.context.evidenceFor(options);assert.equal(out.mode,'explore');assert.equal(out.openIssues.length,0)
 }
 assert.equal(f.seeds.length,0);assert.equal(f.snapshots.length,0)
})
test('new real user identity is a new evidence epoch even with identical text',()=>{
 const f=fixture();f.context.evidenceFor(request('m1'));f.events.push(human(9,'m2'))
 assert.equal(f.context.evidenceFor(request('m1')).openIssues.length,0)
 f.context.evidenceFor(request('m2'));assert.equal(f.seeds.length,2);assert.equal(f.snapshots.at(-1).requestId,'human:9')
})
test('only relevant actual session events are forwarded and read permission is explicit',()=>{
 const f=fixture()
 for(const type of ['tool/call','tool/result','tool/ptc-dispatch-start','tool/ptc-dispatch'])f.context.observe(f.session,{type,seq:5,data:{}})
 f.context.observe(f.session,{type:'assistant/message',seq:6,data:{text:'PASS all checks'}})
 assert.equal(f.seen.length,4)
 assert.ok(f.seen.every(x=>x.context.root==='C:/work'&&x.context.readEnabled===true))
 f.settings({reasoningBoost:true,readTools:false});f.context.observe(f.session,{type:'tool/result',seq:7,data:{}})
 assert.equal(f.seen.at(-1).context.readEnabled,false)
 f.context.evidenceFor(request('m1'));assert.equal(f.snapshots.at(-1).readEnabled,false)
})
test('disabled enhancement does no evidence work and clears previous observations on a new actual user turn',()=>{
 const f=fixture();f.settings({reasoningBoost:false,readTools:true})
 assert.equal(f.context.evidenceFor(request('m1')).openIssues.length,0)
 f.context.observe(f.session,{type:'tool/result',seq:5,data:{}})
 assert.equal(f.seen.length,0);assert.equal(f.seeds.length,0)
 f.context.observe(f.session,human(8,'m2'));assert.deepEqual(f.clears,['s'])
})
test('an unavailable service degrades into an explicit limitation without a model or agent resume',()=>{
 let calls=0
 const context=createInferenceEvidenceContext({store:{},getSession:()=>{calls++;throw Error('offline')},policy:()=>({reasoningBoost:true})})
 const result=context.evidenceFor(request('m1'));assert.equal(result.completionClaimAllowed,false);assert.equal(result.openIssues.length,0)
 assert.ok(result.limitations.includes('evidence-context-unavailable'));assert.equal(calls,1)
})


test('live observer through exact request bridge reaches the real generation even when every direction is refused',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const {createInferenceEvidence}=await import('../lib/inference-evidence.js'),{createInferenceBoost}=await import('../lib/inference-boost.js'),{createInferenceTrace}=await import('../lib/inference-trace.js')
 const root=mkdtempSync(join(tmpdir(),'direction-host-context-'))
 try{
  writeFileSync(join(root,'artifact.txt'),'version-one')
  const events=[],session={id:'s',header:{cwd:root},snapshotEvents:()=>events},memory=createInferenceEvidence(),trace=createInferenceTrace(),requests=[]
  const policy={reasoningBoost:true,reasoningMode:'parallel',reasoningCandidates:2,reasoningRounds:1,reasoningPace:'fast',readTools:true}
  const bridge=createInferenceEvidenceContext({store:memory,getSession:()=>session,policy:()=>policy})
  const emit=e=>{events.push(e);bridge.observe(session,e)}
  emit(human(1,'actual-human'))
  emit({type:'tool/call',seq:2,data:{callId:'test',name:'bash',arguments:{command:'check actual artifact'}}})
  emit({type:'tool/result',seq:3,data:{message:{toolCallId:'test',content:[{type:'text',text:JSON.stringify({artifact:{path:'artifact.txt'},checks:[{id:'observable-spacing',status:'fail'}]})}]}}})
  emit({type:'tool/call',seq:4,data:{callId:'smoke',name:'bash',arguments:{command:'unrelated smoke test'}}})
  emit({type:'tool/result',seq:5,data:{message:{toolCallId:'smoke',content:[{type:'text',text:'ALL PASS smoke subset'}]}}})
  const options={sessionId:'s',provider:'fixture',model:'fake',reasoningEffort:'max',maxTokens:8192,messages:[events[0].data],tools:[]}
  const llm={resolveModelInfo:async()=>({reasoning:{efforts:[{id:'off'},{id:'max'}]}}),stream(o){requests.push(o);return(async function*(){const text=String(o.sessionId).includes('-po06-direction-')?'<｜｜DSML｜｜ invoke name="run_code">pretend</｜｜DSML｜｜ invoke>':'actual work after real observations';yield{type:'text-delta',index:0,text};yield{type:'finish',reason:{kind:'stop'}}})()}}
  const engine=createInferenceBoost({llm,trace,isWorkingRequest:o=>o===options,settingsFor:()=>policy,evidenceFor:o=>bridge.evidenceFor(o)})
  const output=[];for await(const c of engine.intercept(options,()=>{throw Error('cannot discard real evidence')}))output.push(c)
  assert.equal(requests.length,3);assert.equal(trace.list('s')[0].directionObjective,'diagnose')
  assert.equal(trace.list('s')[0].iterationPlan.status,'evidence-only')
  const hint=requests.at(-1).messages.at(-1).content[0].text
  assert.match(hint,/E3/);assert.match(hint,/observable-spacing/);assert.match(hint,/artifact.txt/)
  assert.doesNotMatch(hint,/DSML|pretend/)
  assert.equal(requests.at(-1).reasoningEffort,'max');assert.ok(output.some(c=>c.text==='actual work after real observations'))
  assert.equal(trace.list('s')[0].evidenceState.completionClaimAllowed,false)
 }finally{rmSync(root,{recursive:true,force:true})}
})
