import test from 'node:test'
import assert from 'node:assert/strict'
import {createInferenceBoost,effortPlan,inferencePlan,DIRECTION_MAX_TOKENS,DIRECTION_MAX_CHARS} from '../lib/inference-boost.js'
import {createInferenceTrace} from '../lib/inference-trace.js'
import {normalizeSettings,mergeSettings} from '../lib/settings.js'
import {effectiveSettings} from '../lib/policy.js'
const finish=kind=>({type:'finish',reason:{kind}})
async function* text(s){yield{type:'text-delta',index:0,text:s};yield{type:'block-end',index:0,block:{type:'text',text:s}};yield{type:'usage',usage:{totalTokens:5}};yield finish('stop')}
async function* tool(id){yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name:'write',argumentsDelta:'{"value":"'+id+'"}'};yield{type:'block-end',index:0,block:{type:'tool-call',id,name:'write',arguments:'{"value":"'+id+'"}'}};yield finish('tool-calls')}
const request=()=>Object.freeze({provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'max',maxTokens:256000,sessionId:'sessionA',messages:Object.freeze([{role:'user',content:[{type:'text',text:'complete task'}]}]),tools:[{name:'write',parameters:{type:'object'}}]})
const collect=async stream=>{const chunks=[];for await(const c of stream)chunks.push(c);return chunks}
const isDirection=o=>String(o.sessionId).includes('-po06-direction-')
const config={reasoningBoost:true,reasoningMode:'parallel',reasoningCandidates:2,reasoningRounds:1,reasoningPace:'fast'}
function make(responder,settings=config,options={}){
 const trace=createInferenceTrace(),requests=[]
 const llm={resolveModelInfo:async()=>({reasoning:{efforts:[{id:'off'},{id:'low'},{id:'high'},{id:'max'}],defaultEffort:'high'}}),stream(o){requests.push(o);return responder(o,requests.length)}}
 const boost=createInferenceBoost({llm,trace,isWorkingRequest:o=>o.sessionId==='sessionA',settingsFor:()=>settings,...options})
 return{boost,trace,requests,llm}
}
const waitGate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}

test('default off, session isolation and original settings remain intact',()=>{
 assert.equal(normalizeSettings({}).settings.reasoningBoost,false)
 const raw=mergeSettings({},{bySession:{sessionA:{reasoningBoost:true,reasoningMode:'loop',reasoningRounds:2}}}).settings
 assert.equal(effectiveSettings(raw,'sessionA').reasoningBoost,true)
 assert.equal(effectiveSettings(raw,'sessionB').reasoningBoost,false)
 assert.equal(effectiveSettings(raw,'sessionA').reasoningRounds,2)
 assert.equal(normalizeSettings({reasoningCandidates:99}).settings.reasoningCandidates,2)
})

test('all short directions reach the original worker; no independent selector or candidate implementation runs',async()=>{
 let n=0
 const h=make(o=>isDirection(o)?text('Approach '+(++n)+': use the existing mechanism and observe its premise.'):tool('worker-only'))
 const base=request(),snapshot=JSON.stringify(base)
 const out=await collect(h.boost.intercept(base,()=>{throw Error('unexpected fallback')}))
 assert.equal(h.requests.length,3)
 const directions=h.requests.filter(isDirection),main=h.requests.at(-1)
 for(const d of directions){assert.deepEqual(d.tools,[]);assert.ok(d.maxTokens<=DIRECTION_MAX_TOKENS);assert.notEqual(d.sessionId,base.sessionId);assert.equal(JSON.parse(d.messages[0].content[0].text).task,'complete task');assert.notStrictEqual(d.messages[0],base.messages[0]);assert.ok(d.system,'a dedicated direction system isolates the worker role')}
 assert.equal(main.sessionId,base.sessionId);assert.equal(main.provider,base.provider);assert.equal(main.model,base.model)
 assert.equal(main.reasoningEffort,base.reasoningEffort);assert.equal(main.maxTokens,base.maxTokens);assert.strictEqual(main.tools,base.tools)
 const hint=main.messages.at(-1)
 assert.equal(hint.source.kind,'plugin:@dsh-external/dsh-arbiter-wf');assert.equal(hint.source.form,'notice')
 assert.match(hint.content[0].text,/Approach 1/);assert.match(hint.content[0].text,/Approach 2/)
 assert.equal(JSON.stringify(base),snapshot)
 assert.equal(out.filter(c=>c.block?.type==='tool-call').length,1)
 assert.equal(out.find(c=>c.block?.type==='tool-call').block.id,'worker-only')
 const row=h.trace.list('sessionA')[0]
 assert.deepEqual(row.calls.map(c=>c.kind),['direction','direction','working'])
 assert.equal(row.workflow,'directions-to-worker');assert.equal(row.iterationPlan.callsUsed,3)
 assert.equal(row.iterationPlan.extraCallsUsed,2);assert.equal(row.iterationPlan.workingCallsUsed,1)
 assert.equal(row.iterationPlan.status,'executed')
 const handoff=row.decisions.find(d=>d.kind==='direction-handoff')
 assert.equal(handoff.selection,'working-model');assert.equal(handoff.supplied.length,2)
 assert.equal(handoff.selected,undefined,'the host never invents a winning direction')
 assert.equal(row.selectedCallId,row.calls.at(-1).callId)
})

test('worker keeps complete original native message objects, tools, routes and replay state',async()=>{
 const replayState=Object.freeze({response:{kind:'deepseek-messages',version:1},blocks:[{signature:'NATIVE'}]})
 const assistant=Object.freeze({id:'historic-assistant',role:'assistant',source:{kind:'model',provider:'deepseek-account',model:'deepseek-flash',replayState},content:[{type:'tool-call',id:'read-1',name:'read',arguments:'{"path":"x"}'}]})
 const result=Object.freeze({id:'historic-tool',role:'tool',toolCallId:'read-1',source:{kind:'tool',callId:'read-1'},content:[{type:'text',text:'OBSERVED'}]})
 const base=Object.freeze({...request(),system:'Original system',toolHistory:{rounds:[]},stop:['ACTUAL_STOP'],messages:Object.freeze([...request().messages,assistant,result])})
 const h=make(o=>isDirection(o)?text('Use the observed result.'):tool('actual'))
 await collect(h.boost.intercept(base,()=>text('ordinary')))
 const main=h.requests.at(-1)
 for(let i=0;i<base.messages.length;i++)assert.strictEqual(main.messages[i],base.messages[i])
 assert.strictEqual(main.messages[1].source.replayState,replayState)
 for(const key of ['system','toolHistory','stop','tools','provider','model','reasoningEffort','maxTokens','sessionId'])assert.strictEqual(main[key],base[key],key)
 for(const d of h.requests.filter(isDirection)){assert.equal(d.toolHistory,undefined);assert.equal(d.stop,undefined)}
})

test('only direction text is handed over, never provider reasoning or native direction state',async()=>{
 const h=make(o=>isDirection(o)?(async function*(){yield{type:'reasoning-delta',index:0,text:'PRIVATE_REASONING'};yield{type:'source',source:{replayState:{secret:'PRIVATE_SIGNATURE'}}};yield* text('Useful public method sketch.')} )():text('Actual response'))
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 const appended=JSON.stringify(h.requests.at(-1).messages.at(-1))
 assert.match(appended,/Useful public method sketch/)
 assert.doesNotMatch(appended,/PRIVATE_REASONING|PRIVATE_SIGNATURE/)
})

test('directions are concurrent and main output streams immediately with original chunks',async()=>{
 const ready=waitGate(),release=waitGate();let live=0,max=0,workerEnded=false
 const first={type:'text-delta',index:0,text:'LIVE'},last={type:'finish',reason:{kind:'stop'}}
 const h=make(o=>isDirection(o)?(async function*(){live++;max=Math.max(live,max);if(live===2)ready.resolve();await release.promise;live--;yield* text('Method '+o.sessionId)})():(async function*(){yield first;await releaseWorker.promise;workerEnded=true;yield last})())
 const releaseWorker=waitGate(),stream=h.boost.intercept(request(),()=>text('ordinary'))[Symbol.asyncIterator](),pending=stream.next()
 await ready.promise;assert.equal(h.requests.length,2);assert.equal(max,2);release.resolve()
 const got=await pending;assert.strictEqual(got.value,first);assert.equal(workerEnded,false,'never collect the real worker before forwarding')
 releaseWorker.resolve();assert.strictEqual((await stream.next()).value,last);assert.equal((await stream.next()).done,true)
})

test('all unusable directions resume the untouched normal stream exactly once',async()=>{
 for(const kind of ['error','aborted','max-tokens','length','empty','tool','code','long','throw']){
  let fallbacks=0
  const h=make(o=>{assert.ok(isDirection(o));if(kind==='throw')throw Error('provider-down');if(kind==='tool')return tool('untrusted');if(kind==='code')return text(String.fromCharCode(96).repeat(3)+'js\nfull implementation');if(kind==='long')return text('x'.repeat(DIRECTION_MAX_CHARS+1));return(async function*(){if(kind!=='empty')yield{type:'text-delta',index:0,text:'partial direction'};yield finish(kind==='empty'?'stop':kind)})()})
  const real={type:'text-delta',index:0,text:'ordinary output'}
  const out=await collect(h.boost.intercept(request(),()=>{fallbacks++;return(async function*(){yield real;yield finish('stop')})()}))
  assert.equal(fallbacks,1,kind);assert.equal(h.requests.length,2,kind);assert.strictEqual(out[0],real,kind)
  const row=h.trace.list('sessionA')[0]
  assert.equal(row.stage,'done',kind);assert.equal(row.iterationPlan.status,'degraded',kind);assert.equal(row.directionCallIds.length,0)
  assert.deepEqual(h.trace.get('sessionA',row.runId,row.calls.at(-1).callId,{input:true}).input.messages[0].content,request().messages[0].content)
 }
})

test('a failed direction does not discard a different usable one or create a judge retry',async()=>{
 let n=0
 const h=make(o=>isDirection(o)?++n===1?(async function*(){yield finish('error')})():text('Only useful direction.'):text('Actual work'))
 await collect(h.boost.intercept(request(),()=>{throw Error('not ordinary')}))
 assert.equal(h.requests.length,3);const row=h.trace.list('sessionA')[0]
 assert.equal(row.directionCallIds.length,1);assert.ok(row.decisions.some(d=>d.kind==='direction-unavailable'))
 assert.match(h.requests.at(-1).messages.at(-1).content[0].text,/Only useful direction/)
})

test('tool proposals made by a direction are never executed or submitted',async()=>{
 const h=make(()=>tool('direction-tool'));let ordinary=0
 const out=await collect(h.boost.intercept(request(),()=>{ordinary++;return tool('only-worker')}))
 assert.equal(ordinary,1)
 assert.deepEqual(out.filter(c=>c.block?.type==='tool-call').map(c=>c.block.id),['only-worker'])
 assert.ok(h.requests.every(o=>o.tools.length===0))
})

test('worker failures after a tool chunk never cause a second generation or replay',async()=>{
 let workerCalls=0,ordinary=0
 const h=make(o=>isDirection(o)?text('Use a real observation.'): (async function*(){workerCalls++;yield{type:'block-end',index:0,block:{type:'tool-call',id:'effect-once',name:'write',arguments:'{}'}};throw Error('stream-lost')})())
 const out=[]
 await assert.rejects(async()=>{for await(const c of h.boost.intercept(request(),()=>{ordinary++;return tool('repeat')}))out.push(c)},/stream-lost/)
 assert.equal(workerCalls,1);assert.equal(ordinary,0);assert.equal(out.filter(c=>c.block?.type==='tool-call').length,1)
 assert.equal(h.trace.list('sessionA')[0].stage,'failed')
})

test('explicit main error finish is forwarded and recorded without a retry',async()=>{
 let actual=0;const error=finish('error')
 const h=make(o=>isDirection(o)?text('A direction.'): (async function*(){actual++;yield error})())
 const out=await collect(h.boost.intercept(request(),()=>{throw Error('duplicate fallback')}))
 assert.strictEqual(out[0],error);assert.equal(actual,1);assert.equal(h.trace.list('sessionA')[0].stage,'failed')
})

test('external cancellation during directions emits no output and starts no worker',async()=>{
 const gate=waitGate(),ac=new AbortController()
 const h=make(o=>(async function*(){gate.resolve();await new Promise(r=>{if(o.signal.aborted)r();else o.signal.addEventListener('abort',r,{once:true})});yield* text('late')})())
 const pending=collect(h.boost.intercept({...request(),signal:ac.signal},()=>{throw Error('fallback after parent abort')}))
 await gate.promise;ac.abort(Error('user-cancel'));assert.deepEqual(await pending,[])
 assert.equal(h.requests.length,2);assert.equal(h.trace.list('sessionA')[0].stage,'cancelled');assert.equal(h.boost.status().activeRuns,0)
})

test('stopping only extra direction work resumes ordinary execution once',async()=>{
 const gate=waitGate();let ordinary=0
 const h=make(o=>(async function*(){gate.resolve();await new Promise(r=>{if(o.signal.aborted)r();else o.signal.addEventListener('abort',r,{once:true})})})())
 const pending=collect(h.boost.intercept(request(),()=>{ordinary++;return text('Continue actual task')}))
 await gate.promise;const row=h.trace.list('sessionA')[0]
 assert.equal(h.boost.cancel('sessionA',row.runId).ok,true)
 const out=await pending;assert.equal(ordinary,1);assert.ok(out.some(c=>c.text==='Continue actual task'))
 assert.equal(h.trace.list('sessionA')[0].iterationPlan.status,'degraded');assert.equal(h.boost.status().activeRuns,0)
})

test('early consumer close cleans up the active run; it does not leave a running badge',async()=>{
 const h=make(o=>text(isDirection(o)?'Direction':'Worker'))
 const stream=h.boost.intercept(request(),()=>text('ordinary'))[Symbol.asyncIterator]()
 await stream.next();await stream.return()
 assert.equal(h.boost.status().activeRuns,0);assert.equal(h.trace.list('sessionA')[0].stage,'cancelled')
})

test('all plugin-created direction and working requests bypass recursive boost entry',async()=>{
 const trace=createInferenceTrace(),requests=[];let boost
 const responder=o=>isDirection(o)?text('Short direction.'):tool('actual-once')
 const llm={stream(o){requests.push(o);return boost.intercept(o,()=>responder(o))}}
 boost=createInferenceBoost({llm,trace,isWorkingRequest:()=>true,settingsFor:()=>config})
 const out=await collect(boost.intercept(request(),()=>{throw Error('normal unexpected')}))
 assert.equal(requests.length,3);assert.equal(trace.list('sessionA').length,1)
 assert.equal(out.filter(c=>c.block?.type==='tool-call').length,1)
})

test('boost off and auxiliary requests keep the ordinary stream by identity with zero extra calls',()=>{
 for(const opts of [{reasoningBoost:false},config]){
  const h=make(()=>{throw Error('extra call')},opts),sentinel=text('ordinary')
  const base=opts.reasoningBoost?{...request(),sessionId:'auxiliary'}:request()
  assert.strictEqual(h.boost.intercept(base,()=>sentinel),sentinel);assert.equal(h.requests.length,0);assert.equal(h.trace.list('sessionA').length,0)
 }
})

test('short-direction effort is supported and the real worker retains its original strength and output ceiling',async()=>{
 let n=0
 const h=make(o=>text(isDirection(o)?'Method '+(++n):'Actual result'))
 h.llm.resolveModelInfo=async()=>({reasoning:{efforts:[{id:'off'},{id:'low'},{id:'high'},{id:'max'}],defaultEffort:'high'}})
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.deepEqual(h.requests.map(o=>o.reasoningEffort),['off','off','max'])
 assert.deepEqual(h.requests.map(o=>o.maxTokens),[DIRECTION_MAX_TOKENS,DIRECTION_MAX_TOKENS,256000])
 assert.equal(effortPlan(request(),'balanced',{reasoning:{efforts:[{id:'low'},{id:'high'}]}}).candidate,'high')
 assert.equal(effortPlan(request(),'inherit',{}).candidate,'max')
 assert.equal(effortPlan(request(),'fast',{}).candidate,'max')
})

test('direction limits never raise a smaller original ceiling and do not force a final language policy',async()=>{
 let n=0
 const h=make(o=>text(isDirection(o)?'Direction '+(++n):'Work'),{...config,englishMode:true})
 const base={...request(),maxTokens:320,messages:[{role:'user',content:[{type:'text',text:'Edit src/x.js and respond in Chinese.'}]}]}
 await collect(h.boost.intercept(base,()=>text('ordinary')))
 assert.ok(h.requests.every(o=>o.maxTokens===320))
 const hint=h.requests.at(-1).messages.at(-1).content[0].text
 assert.doesNotMatch(hint,/[\u4e00-\u9fff]/);assert.match(hint,/choose, combine or disregard/)
 assert.equal(h.requests.at(-1).messages[0].content[0].text,base.messages[0].content[0].text)
})

test('whitespace-only duplicate directions are handed off once without another selection call',async()=>{
 let n=0;const h=make(o=>text(isDirection(o)?++n===1?'Same useful idea.':'  Same\n useful  idea.  ':'Actual work'))
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 const row=h.trace.list('sessionA')[0];assert.equal(row.directionCallIds.length,1);assert.equal(row.calls.length,3)
 assert.ok(row.decisions.some(d=>d.kind==='direction-duplicate'))
})

test('hybrid refines only sketches before a single worker execution, never using a judge',async()=>{
 let n=0
 const h=make(o=>text(isDirection(o)?'Direction '+(++n):'Actual task'),{...config,reasoningMode:'hybrid',reasoningRounds:3,reasoningPace:'balanced'})
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 const row=h.trace.list('sessionA')[0]
 assert.deepEqual(row.calls.map(c=>c.kind),['direction','direction','direction-refinement','working'])
 assert.equal(row.iterationPlan.actualRounds,1);assert.equal(row.iterationPlan.maxCalls,4);assert.equal(row.directionCallIds.length,3)
 assert.equal(row.iterationPlan.callsUsed,4);assert.equal(h.requests.filter(o=>!isDirection(o)).length,1)
 assert.match(h.requests[2].system,/Direction 1/,'refinement references prior sketches in its isolated role')
 assert.match(h.requests.at(-1).messages.at(-1).content[0].text,/Direction 3/)
})

test('the direction plan separates extra work from one real model generation and clamps unsafe inputs',()=>{
 for(const mode of ['parallel','hybrid'])for(const pace of ['fast','balanced','inherit'])for(const count of [2,3])for(const rounds of [1,2,3]){
  const p=inferencePlan({reasoningMode:mode,reasoningPace:pace,reasoningCandidates:count,reasoningRounds:rounds})
  assert.equal(p.workflow,'directions-to-worker');assert.equal(p.maxCalls,p.maxExtraCalls+1)
  assert.ok(p.effectiveRounds<=p.requestedRounds);assert.equal(p.effectiveCandidates,count)
 }
 assert.equal(inferencePlan({reasoningCandidates:999}).effectiveCandidates,3)
 assert.equal(inferencePlan({reasoningCandidates:-4}).effectiveCandidates,2)
 assert.equal(inferencePlan({reasoningMode:'loop',reasoningRounds:3,reasoningPace:'inherit'}).workflow,'reply-loop')
 assert.equal(inferencePlan({reasoningMode:'loop',reasoningRounds:3,reasoningPace:'inherit'}).effectiveRounds,3)
})

test('pure feedback loop still compares a complete revision with its original and preserves trace',async()=>{
 let n=0
 const h=make(o=>{
  if(o.system?.includes('具体反馈者'))return text(JSON.stringify({revise:true,feedback:'fix a concrete error',summary:'one correction'}))
  if(o.system?.includes('候选选择器')){const a=JSON.parse(o.messages[0].content[0].text);return text(JSON.stringify({selected:a.material.find(x=>x.text==='revision').id,reason:'real fix',summary:'improved'}))}
  return text(++n===1?'original':'revision')
 },{...config,reasoningMode:'loop'})
 const result=await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.ok(result.some(c=>c.text==='revision'))
 assert.deepEqual(h.trace.list('sessionA')[0].calls.map(c=>c.kind),['candidate','feedback','revision','selector'])
 assert.equal(h.trace.list('sessionA')[0].summary,'improved')
})

test('pure-loop unchanged revisions stop without another selector or feedback',async()=>{
 const h=make(o=>text(o.system?JSON.stringify({revise:true,feedback:'fix a concrete error',summary:'one correction'}):'same answer'),{...config,reasoningMode:'loop',reasoningRounds:3})
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.deepEqual(h.trace.list('sessionA')[0].calls.map(c=>c.kind),['candidate','feedback','revision'])
 assert.ok(h.trace.list('sessionA')[0].decisions.some(d=>d.skipped))
})

test('pure-loop rejected revision keeps the original and stops further cycles',async()=>{
 let n=0
 const h=make(o=>{
  if(o.system?.includes('具体反馈者'))return text(JSON.stringify({revise:true,feedback:'possible correction',summary:'review'}))
  if(o.system){const a=JSON.parse(o.messages[0].content[0].text);return text(JSON.stringify({selected:a.material.find(c=>c.text==='original').id,reason:'keep original',summary:'keep'}))}
  return text(++n===1?'original':'revised')
 },{...config,reasoningMode:'loop',reasoningRounds:3})
 const result=await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.equal(h.requests.length,4);assert.ok(result.some(c=>c.text==='original'))
})

test('trace exposes reported reasoning separately and keeps session lookup isolated',()=>{
 const t=createInferenceTrace(),id=t.start('sessionA',{},{}),call=t.startCall(id,{kind:'direction',label:'direction',input:{},route:{}}),long='x'.repeat(50000)
 t.chunk(id,call,{type:'text-delta',index:0,text:long});t.chunk(id,call,{type:'reasoning-delta',index:1,text:'provider reasoning'})
 assert.equal(t.get('sessionA',id,call,{text:49999,reasoning:9}).textDelta,'x')
 assert.equal(t.get('sessionA',id,call).textLength,long.length)
 assert.equal(t.get('otherSession',id,call),null)
})


test('disabling extra inference during real worker streaming does not abort the actual task',async()=>{
 const gate=waitGate(),state={...config};let workSignal
 const h=make(o=>isDirection(o)?text('A useful sketch.'):(async function*(){workSignal=o.signal;yield{type:'text-delta',index:0,text:'started'};await gate.promise;yield finish('stop')})(),state)
 const stream=h.boost.intercept(request(),()=>{throw Error('duplicate worker')})[Symbol.asyncIterator]()
 await stream.next();state.reasoningBoost=false;h.boost.settingsChanged()
 assert.equal(workSignal.aborted,false)
 assert.equal(h.boost.cancel('sessionA',h.trace.list('sessionA')[0].runId).reason,'no-extra-inference')
 gate.resolve();while(!(await stream.next()).done){}
 assert.equal(h.trace.list('sessionA')[0].stage,'done')
})

test('parent cancellation still cancels the actual worker after direction handoff',async()=>{
 const ac=new AbortController();let workers=0
 const h=make(o=>isDirection(o)?text('A useful sketch.'):(async function*(){workers++;yield{type:'text-delta',index:0,text:'started'};yield{type:'text-delta',index:0,text:'late'};yield finish('stop')})())
 const stream=h.boost.intercept({...request(),signal:ac.signal},()=>{throw Error('unexpected fallback')})[Symbol.asyncIterator]()
 assert.equal((await stream.next()).value.text,'started');ac.abort(Error('stop real task'))
 assert.equal((await stream.next()).done,true);assert.equal(workers,1)
 assert.equal(h.trace.list('sessionA')[0].stage,'cancelled');assert.equal(h.boost.status().activeRuns,0)
})

test('explicit hybrid full rounds spend only short direction calls before one worker',async()=>{
 let n=0
 const h=make(o=>text(isDirection(o)?'Useful idea '+(++n):'Actual work'),{...config,reasoningMode:'hybrid',reasoningRounds:3,reasoningPace:'inherit'})
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 const row=h.trace.list('sessionA')[0]
 assert.deepEqual(row.calls.map(c=>c.kind),['direction','direction','direction-refinement','direction-refinement','direction-refinement','working'])
 assert.equal(row.iterationPlan.extraCallsUsed,5);assert.equal(row.iterationPlan.workingCallsUsed,1)
 assert.equal(row.iterationPlan.callsUsed,row.iterationPlan.maxCalls)
})


const reportedEvidence=()=>({version:1,requestId:'human:4',mode:'diagnose',openIssues:[{id:'E17',kind:'reported-failure',status:'open',label:'spacing varies',excerpt:'TRACE worldSpacing min=0.0003 | FAIL spacing varies | PASS no discontinuity',source:{id:'E17',seq:17},binding:{path:'artifact.html',sha256:'a'.repeat(64),versionStatus:'observed-fresh'}}],recentEvidence:[],limitations:[],completionClaimAllowed:false})
test('actual reported failures change the direction objective and reach the worker with their source and version',async()=>{
 let n=0,contexts=0
 const h=make(o=>text(isDirection(o)?'Compare the actual world-space gap with an independently sampled path '+(++n)+'.':'Actual work'),config,{evidenceFor:()=>{contexts++;return reportedEvidence()}})
 await collect(h.boost.intercept(request(),()=>{throw Error('no fallback')}))
 assert.equal(contexts,1)
 for(const d of h.requests.filter(isDirection)){assert.match(d.system,/E17/);assert.match(d.system,/hypothes|假设|解释/i);assert.match(d.system,/distinguish|区分|判别/i);assert.match(d.system,/artifact.html/)}
 const main=h.requests.at(-1),hint=main.messages.at(-1).content[0].text
 assert.match(hint,/E17/);assert.match(hint,/0.0003/);assert.match(hint,/a{64}/)
 const row=h.trace.list('sessionA')[0];assert.equal(row.directionObjective,'diagnose');assert.equal(row.evidenceState.openIssues[0].criterion,'spacing varies')
 assert.equal(row.evidenceState.completionClaimAllowed,false)
})

test('all DSML directions are rejected, while real unresolved evidence still reaches one original worker',async()=>{
 const dsml='<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="run_code">await tools.write({path:"x"})</｜｜DSML｜｜ invoke>'
 let working=0
 const h=make(o=>isDirection(o)?text(dsml):(working++,tool('only-actual-worker')),config,{evidenceFor:reportedEvidence})
 const out=await collect(h.boost.intercept(request(),()=>{throw Error('must preserve evidence even when sketches are all rejected')}))
 assert.equal(working,1);assert.equal(h.requests.length,3)
 const hint=h.requests.at(-1).messages.at(-1).content[0].text
 assert.doesNotMatch(hint,/DSML|await tools.write/);assert.match(hint,/E17/)
 assert.equal(out.filter(c=>c.block?.type==='tool-call').length,1)
 const row=h.trace.list('sessionA')[0]
 assert.equal(row.iterationPlan.validDirections,0);assert.equal(row.iterationPlan.rejectedDirections,2)
 assert.ok(row.decisions.filter(d=>d.kind==='direction-unavailable').every(d=>d.reason==='direction-tool-protocol'))
})

test('inherit controls requested rounds but direction effort never inherits max when light effort is supported',async()=>{
 let n=0
 const h=make(o=>text(isDirection(o)?'Different approach '+(++n):'Work'),{...config,reasoningMode:'hybrid',reasoningRounds:3,reasoningPace:'inherit'})
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.ok(h.requests.filter(isDirection).every(o=>o.reasoningEffort==='low'&&o.maxTokens===4096))
 assert.equal(h.requests.at(-1).reasoningEffort,'max');assert.equal(h.requests.at(-1).maxTokens,256000)
 const row=h.trace.list('sessionA')[0]
 assert.equal(row.iterationPlan.actualRounds,3);assert.equal(row.directionPolicy,'direction-light-reasoning');assert.equal(row.directionMaxTokens,4096)
})

test('missing model metadata preserves the route with an explicit bounded limited policy',async()=>{
 const h=make(o=>text(isDirection(o)?'A brief idea.':'Work'));delete h.llm.resolveModelInfo
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.ok(h.requests.filter(isDirection).every(o=>o.reasoningEffort==='max'&&o.maxTokens===4096))
 const row=h.trace.list('sessionA')[0]
 assert.equal(row.effortPlan.limited,true);assert.equal(row.directionPolicy,'direction-metadata-unknown')
})

test('auxiliary quoted context excludes private reasoning/native replay data and has no executable worker system',async()=>{
 const prior={id:'a1',role:'assistant',source:{kind:'model',replayState:{secret:'NATIVE_SECRET'}},content:[{type:'reasoning',text:'PRIVATE_ORIGINAL_REASONING'},{type:'text',text:'Public progress report.'},{type:'tool-call',id:'t1',name:'read',arguments:'{"path":"artifact.html"}'}]}
 const base={...request(),system:'ORIGINAL_WORKER_MUST_USE_TOOL',messages:[...request().messages,prior]}
 const h=make(o=>text(isDirection(o)?'Compare observations.':'Work'))
 await collect(h.boost.intercept(base,()=>text('ordinary')))
 const d=h.requests.find(isDirection),quoted=JSON.stringify(d.messages)
 assert.doesNotMatch(quoted,/NATIVE_SECRET|PRIVATE_ORIGINAL_REASONING/)
 assert.match(quoted,/Public progress report/);assert.doesNotMatch(d.system,/ORIGINAL_WORKER_MUST_USE_TOOL/)
 assert.strictEqual(h.requests.at(-1).messages[1],prior);assert.equal(h.requests.at(-1).system,base.system)
})

test('off requests never collect extra evidence and unavailable evidence does not fail actual work',async()=>{
 const off=make(()=>{throw Error('extra model call')},{...config,reasoningBoost:false},{evidenceFor:()=>{throw Error('off must not read evidence')}})
 const sentinel=text('ordinary');assert.strictEqual(off.boost.intercept(request(),()=>sentinel),sentinel)
 const h=make(o=>text(isDirection(o)?'A public idea.':'Actual task'),config,{evidenceFor:()=>{throw Error('unavailable')}})
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.equal(h.trace.list('sessionA')[0].stage,'done')
 assert.ok(h.trace.list('sessionA')[0].evidenceState.limitations.includes('evidence-context-unavailable'))
})

test('pure reply loop receives real unclosed observations without a new evidence judge call',async()=>{
 const h=make(o=>text(o.system?.includes('具体反馈者')?JSON.stringify({revise:false,feedback:'',summary:'retain'}):'Original reply'),{...config,reasoningMode:'loop'},{evidenceFor:reportedEvidence})
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.equal(h.requests.length,2)
 assert.match(h.requests[0].messages.at(-1).content[0].text,/E17/)
 assert.deepEqual(h.trace.list('sessionA')[0].calls.map(c=>c.kind),['candidate','feedback'])
})


test('an extra direction deadline aborts only that role and preserves earlier ideas for a single real worker',async()=>{
 let n=0,workers=0
 const h=make(o=>{
  if(!isDirection(o)){workers++;return tool('work-after-deadline')}
  if(++n===1)return text('Use the independently measured condition.')
  return(async function*(){await new Promise(resolve=>{if(o.signal.aborted)resolve();else o.signal.addEventListener('abort',resolve,{once:true})});yield{type:'text-delta',index:0,text:'late and unusable'};yield finish('stop')})()
 },config,{directionTimeoutMs:8,preparationTimeoutMs:40})
 const out=await collect(h.boost.intercept(request(),()=>{throw Error('must use surviving direction')}))
 assert.equal(workers,1);assert.equal(out.filter(c=>c.block?.type==='tool-call').length,1)
 const row=h.trace.list('sessionA')[0];assert.equal(row.iterationPlan.validDirections,1)
 assert.ok(row.decisions.some(d=>d.reason==='direction-call-timeout'),JSON.stringify(row.decisions));assert.equal(h.requests.at(-1).signal.aborted,false)
 assert.equal(row.timingPolicy.workingUnchanged,true)
})

test('total direction preparation stops extra rounds while retaining valid context and unchanged main generation',async()=>{
 let n=0
 const h=make(o=>{
  if(!isDirection(o))return text('actual task')
  if(++n<=2)return text('Public useful idea '+n)
  return(async function*(){await new Promise(resolve=>{if(o.signal.aborted)resolve();else o.signal.addEventListener('abort',resolve,{once:true})});yield finish('aborted')})()
 },{...config,reasoningMode:'hybrid',reasoningPace:'inherit',reasoningRounds:3},{directionTimeoutMs:100,preparationTimeoutMs:12})
 await collect(h.boost.intercept(request(),()=>{throw Error('must keep usable directions')}))
 const row=h.trace.list('sessionA')[0]
 assert.equal(row.iterationPlan.validDirections,2);assert.equal(h.requests.filter(o=>!isDirection(o)).length,1)
 assert.ok(row.decisions.some(d=>d.reason==='direction-preparation-timeout'))
 assert.equal(h.requests.at(-1).reasoningEffort,'max');assert.equal(h.requests.at(-1).signal.aborted,false)
})
