import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeToolbox, renderToolboxProposal, hasToolboxContent, TOOLBOX_PROMPT } from '../lib/toolbox-proposal.js'
import { captureToolboxContext, summarizeToolboxContext } from '../lib/toolbox-context.js'
import { parseOptimizerValue, renderOptimizerPacket, composeOptimizerSystem, buildOptimizerUserMessage } from '../lib/optimizer-protocol.js'
import { adapter as productionAdapter, buildInterpreterProtocol } from '../lib/index.js'
import { createCapability, normalizeCollaboration } from '../lib/capability.js'
import { createState } from '../lib/schema.js'
import { reduce, recordUserInput } from '../lib/reducer.js'
import { normalizeSettings, mergeSettings } from '../lib/settings.js'
import { policyFor, packetShapeChanged } from '../lib/policy.js'
import { prepareEnglishInterpretation } from '../lib/english-mode.js'
import { createTaskToolboxStore } from '../lib/toolbox-state.js'

const proposal = (extra={}) => ({ recommendation:'build', reason:'Repeated shape adjustments need comparable observations.',
  basis:['The task specifies HTML + Three.js; existing tools are not yet known.'],
  capabilities:['Change a named part without rebuilding unrelated parts.'],
  feedback:['Capture the same view and read the comparison before the next change.'],
  firstUse:'Correct the wheel-to-body relation in the first working artifact.', stopWhen:'Stop extending when the real repeated work is covered.', ...extra })
const value = (extra={}) => ({intent:{text:'Create the requested HTML model.',relation:'new'},clarify:[],add:[],ask:[],decide:[],...extra})
function fixture(capability=createCapability()) {
  const a = new productionAdapter.constructor()
  a.capability=capability
  a.toolboxStore=createTaskToolboxStore()
  a.policyNow=()=>({advisor:false,toolboxMode:'auto'})
  a.services.agents={get:()=>({})}
  const states=new Map()
  a.intentStateOf=s=>states.get(s.id)||null
  a.initIntent=(s,{taskId})=>{const state=createState({sessionId:s.id,taskId});states.set(s.id,state);return {ok:true,state}}
  a.commitUserInput=(s,input)=>{const state=recordUserInput(states.get(s.id),input);states.set(s.id,state);return {ok:true,state}}
  a.commit=(s,patch)=>{const result=reduce(states.get(s.id),patch);if(result.ok)states.set(s.id,result.state);return result}
  return a
}

test('proposal modes preserve capabilities, feedback, real first use and stop conditions',()=>{
  for(const recommendation of ['reuse','build','inspect']){
    const {proposal:p,warnings}=normalizeToolbox(proposal({recommendation}))
    assert.equal(p.version,'1');assert.equal(p.recommendation,recommendation);assert.deepEqual(warnings,[])
    const text=renderToolboxProposal(p,'en')
    for(const fragment of [p.reason,...p.capabilities,...p.feedback,p.firstUse,p.stopWhen])assert.ok(text.includes(fragment))
    assert.match(text,/working model|Working model/);assert.match(text,/delivery requirements/)
  }
})
test('none, omission and off do not create a toolbox section',()=>{
  for(const p of [undefined,null,{recommendation:'none'}]){
    assert.equal(hasToolboxContent(p),false);assert.equal(renderToolboxProposal(p),'')
  }
  assert.equal(normalizeToolbox(proposal(),{enabled:false}).proposal,null)
  assert.equal(renderOptimizerPacket(value({toolbox:{recommendation:'none'}})),'')
})
test('malformed optional proposal never rejects valid intent, additions or ask',()=>{
  for(const toolbox of ['build',[],{recommendation:'always'},{recommendation:'build'},proposal({version:'999'})]){
    const r=parseOptimizerValue(value({toolbox,add:['keep this'],ask:['Which form? | A / B']}))
    assert.equal(r.ok,true);assert.equal(r.optimizer.toolbox,undefined);assert.ok(r.warnings.length)
    const text=renderOptimizerPacket(r.optimizer)
    assert.ok(text.includes('keep this'));assert.ok(text.includes('ask_user_question'))
  }
})
test('optional field normalization retains valid text without accepting model authority',()=>{
  const input=proposal({capabilities:'a useful operation',feedback:[1],taskId:'fake',authorized:true,verified:true})
  const {proposal:p,warnings}=normalizeToolbox(input)
  assert.deepEqual(p.capabilities,['a useful operation']);assert.deepEqual(p.feedback,[])
  assert.ok(warnings.includes('toolbox:feedback-invalid'));assert.equal(p.taskId,undefined);assert.equal(p.authorized,undefined);assert.equal(p.verified,undefined)
  const parsed=parseOptimizerValue(value({toolbox:input,toolboxBinding:{source:'human'}}),{sessionId:'s',messageId:'m',baseInputRevision:2})
  assert.equal(parsed.optimizer.toolboxBinding.source,'model');assert.equal(parsed.optimizer.toolboxBinding.status,'proposed');assert.equal(parsed.optimizer.toolboxBinding.inputId,'m')
  const long='specific requirement '.repeat(200);assert.equal(normalizeToolbox(proposal({reason:long})).proposal.reason,long.trim())
})
test('ask then toolbox then original/advice, with no change to verbatim user text',()=>{
  const userText='HTML + Three.js, final file only; do not switch stack.'
  const parsed=parseOptimizerValue(value({toolbox:proposal(),ask:['Choose a form? | A / B']}))
  const text=renderOptimizerPacket(parsed.optimizer,'en',{userText})
  assert.ok(text.indexOf('ask_user_question')<text.indexOf('[Working method'))
  assert.ok(text.indexOf('[Working method')<text.indexOf('[Prompt assistance'))
  assert.ok(text.includes('> '+userText));assert.ok(text.includes('not an existing tool'))
  assert.ok(parsed.patch.ops.every(op=>!op.item||op.item.kind!=='user_requirement'))
})
test('toolbox-only passes the real adapter pipeline without a state patch or retry',async()=>{
  const a=fixture(),session={id:'toolbox-only'};let calls=0
  const out=await a.handleInput(session,{messageId:'m1',text:'Build a Three.js scene',policy:{toolboxMode:'auto'},interpret:async()=>{calls++;return JSON.stringify(value({toolbox:proposal()}))}})
  assert.equal(calls,1);assert.equal(out.outcome,'understood');assert.equal(out.noStatePatch,true);assert.equal(out.zeroAddition,false)
  assert.ok(out.packet.text.includes('[Working method')||out.packet.text.includes('本轮工作方法'))
  assert.equal(a.getWorkingText(session.id),out.packet.text)
  assert.equal(a.intentStateOf(session).items.length,0,'proposal is not a new user requirement')
  assert.equal(a.capability.status(session.id).current.metrics.zeroAddition,0)
})
test('old response and explicit off preserve the original successful empty path',async()=>{
  for(const raw of [value(),value({toolbox:proposal()})]){
    const a=fixture(),s={id:'off'}
    const out=await a.handleInput(s,{messageId:'m1',text:'ok',policy:{toolboxMode:'off'},interpret:async()=>JSON.stringify(raw)})
    assert.equal(out.outcome,'understood');assert.equal(out.zeroAddition,true);assert.equal(out.packet.text,'');assert.equal(out.optimizer.toolbox,undefined)
  }
})
test('proposal survives capability persistence and a new input does not inherit it',()=>{
  const home=mkdtempSync(join(tmpdir(),'toolbox-proposal-'))
  try{
    const first=createCapability({home,namespace:'trial'}),token=first.beginInput('s','m1','Build')
    const parsed=parseOptimizerValue(value({toolbox:proposal()}))
    first.settle('s',token,{...parsed,zeroAddition:false})
    const restored=createCapability({home,namespace:'trial'})
    assert.deepEqual(restored.status('s').current.optimizer.toolbox,parsed.optimizer.toolbox)
    restored.beginInput('s','m2','continue');assert.equal(restored.status('s').current.optimizer,null,'actual tool facts will have a separate durable lifecycle')
    const corrupt=normalizeCollaboration({optimizer:{...parsed.optimizer,toolbox:{authorized:true}}})
    assert.equal(corrupt.optimizer.toolbox,undefined)
  }finally{rmSync(home,{recursive:true,force:true})}
})
test('parallel input and cancellation cannot re-inject a stale toolbox proposal',async()=>{
  const a=fixture(),s={id:'s'};let release,entered
  const started=new Promise(r=>{entered=r})
  const pending=a.handleInput(s,{messageId:'old',text:'old',interpret:async()=>{entered();return await new Promise(r=>{release=r})}})
  await started
  await a.handleInput(s,{messageId:'new',text:'new',interpret:async()=>JSON.stringify(value({add:['current']}))})
  release(JSON.stringify(value({toolbox:proposal()})));const old=await pending
  assert.equal(old.outcome,'superseded-input');assert.equal(a.getWorkingText('s').includes('本轮工作方法'),false)
  const controller=new AbortController()
  const cancelled=await a.handleInput(s,{messageId:'cancel',text:'cancel',signal:controller.signal,interpret:async()=>{controller.abort();return JSON.stringify(value({toolbox:proposal()}))}})
  assert.equal(cancelled.outcome,'aborted');assert.equal(a.getWorkingText('s'),'')
})
test('snapshot uses exactly the requested session and labels tool registration truthfully',async()=>{
  let requested;const context=await captureToolboxContext({sessionId:'wanted',workspace:'C:/project',now:()=>123,
    agents:{get:async id=>{requested=id;return {session:{id},ctx:{tools:{schemas:()=>[{name:'render',description:'Produces a capture'}]}}}},list:()=>{throw Error('must not enumerate other sessions')}},
    tools:{schemas:()=>[{name:'other-session'}]}})
  assert.equal(requested,'wanted');assert.equal(context.scope,'session');assert.equal(context.coverage,'complete');assert.equal(context.observedAt,123)
  assert.deepEqual(context.tools.map(x=>x.name),['render']);assert.equal(context.tools[0].evidence,'registered-only');assert.equal(context.imageObservation,'unknown')
})
test('missing, failed and global capability lookups remain unknown or partial, never absent',async()=>{
  const missing=await captureToolboxContext({sessionId:'s'})
  assert.equal(missing.coverage,'unknown');assert.equal(missing.scope,'unknown')
  const global=await captureToolboxContext({sessionId:'s',agents:{get:()=>{throw Error('offline')}},tools:{schemas:()=>[{name:'global'}]}})
  assert.equal(global.scope,'global');assert.equal(global.coverage,'partial');assert.equal(global.reason,'session-agent-query-failed')
  const wrong=await captureToolboxContext({sessionId:'s',agents:{get:()=>({session:{id:'other'},ctx:{tools:{schemas:()=>[{name:'private'}]}}})}})
  assert.equal(wrong.coverage,'unknown');assert.equal(wrong.reason,'session-agent-mismatch');assert.deepEqual(wrong.tools,[])
})
test('confirmed empty scoped table differs from malformed or failed table',async()=>{
  for(const [schemas,coverage]of [[()=>[],'complete'],[()=>[{}],'unknown'],[()=>null,'unknown'],[()=>{throw Error('bad')},'unknown']]){
    const out=await captureToolboxContext({sessionId:'s',agents:{get:()=>({ctx:{tools:{schemas}}})}})
    assert.equal(out.coverage,coverage)
  }
})
test('the capability summary is serialized into the actual optimizer user message',async()=>{
  const capabilitySummary=await captureToolboxContext({sessionId:'s',tools:{schemas:()=>[{name:'shell',description:'x'.repeat(500)}]}})
  const user=JSON.parse(buildOptimizerUserMessage({userText:'my original',capabilitySummary}))
  assert.equal(user.originalText,'my original');assert.equal(user.capabilitySummary.scope,'global');assert.equal(user.capabilitySummary.coverage,'partial')
  assert.equal(user.capabilitySummary.tools[0].descriptionTruncated,true)
  assert.equal(JSON.parse(buildOptimizerUserMessage({userText:'x'})).capabilitySummary,undefined)
  assert.equal(summarizeToolboxContext({scope:'global',coverage:'complete'}).coverage,'partial')
})
test('actual adapter context method uses its own session services independently of readTools',async()=>{
  const a=fixture();a.services.agents={get:id=>({session:{id},ctx:{tools:{schemas:()=>[{name:'working-executor'}]}}})}
  const context=await a.toolboxContextFor({id:'s',cwd:'C:/project'})
  assert.equal(context.scope,'session');assert.equal(context.tools[0].name,'working-executor');assert.equal(a.toolboxContexts.get('s'),context)
})
test('feature policy follows normalization, session overrides, packet invalidation and assist off',()=>{
  assert.equal(normalizeSettings({}).settings.toolboxMode,'auto')
  assert.equal(mergeSettings({}, {toolboxMode:'off'}).settings.toolboxMode,'off')
  const settings={assist:'auto',toolboxMode:'auto',advisor:false,bySession:{a:{toolboxMode:'off'}}}
  assert.equal(policyFor(settings,'a').toolboxMode,'off');assert.equal(policyFor(settings,'b').toolboxMode,'auto')
  assert.equal(policyFor({...settings,assist:'off'},'b').toolboxMode,'off')
  assert.equal(packetShapeChanged(policyFor(settings,'b'),policyFor({...settings,toolboxMode:'off'},'b')),true)
  assert.equal(normalizeSettings({toolboxMode:'unlimited'}).problems[0].key,'toolboxMode')
})
test('optional prompt is versioned and identical in tool and no-tool fallbacks with custom core',async()=>{
  const home=mkdtempSync(join(tmpdir(),'toolbox-system-'))
  try{
    writeFileSync(join(home,'po06-prompt.md'),'Custom core stays verbatim.')
    const p=await buildInterpreterProtocol({home,toolsEnabled:true,toolboxMode:'auto'})
    assert.ok(p.text.startsWith('Custom core stays verbatim.'));assert.ok(p.text.includes(TOOLBOX_PROMPT.zh));assert.ok(p.noToolsText.includes(TOOLBOX_PROMPT.zh));assert.equal(p.revision,'task-toolbox-1')
    assert.equal(composeOptimizerSystem({toolboxMode:'off'}).text.includes(TOOLBOX_PROMPT.zh),false)
  }finally{rmSync(home,{recursive:true,force:true})}
})
test('English task translation stays independent of optional toolbox prose',()=>{
  const english=prepareEnglishInterpretation({...value({toolbox:proposal()}),englishTask:'Create a model.'},'Create a model.')
  assert.equal(english.value.toolbox.reason,proposal().reason)
  const mixed=prepareEnglishInterpretation({...value({toolbox:proposal({reason:'需要重复观察'})}),englishTask:'Create a model.'},'Create a model.')
  assert.equal(mixed.translation.text,'Create a model.');assert.equal(mixed.value.toolbox,undefined);assert.ok(mixed.warnings.some(w=>w.field==='toolbox'))
})

test('native and PTC results reach both optimizer capability input and working context, then survive restart',async()=>{
  const home=mkdtempSync(join(tmpdir(),'toolbox-adapter-'))
  try{
    const a=fixture(),s={id:'task-runtime',header:{cwd:home}},entrypoint=join(home,'workshop.mjs'),project=join(home,'artifact')
    a.toolboxStore=createTaskToolboxStore({home,namespace:'runtime'})
    a.services.agents={get:id=>({session:{id},ctx:{tools:{schemas:()=>[{name:'bash'}]}}})}
    await a.handleInput(s,{messageId:'po06-intercept-first',text:'Make a Three.js artifact',policy:{toolboxMode:'auto'},interpret:async()=>JSON.stringify(value({toolbox:proposal()}))})
    const firstTask=a.toolboxStore.status({sessionId:s.id}).taskId
    const human={type:'user/message',data:{id:'human-first',source:{kind:'user'},content:[{type:'text',text:'Make a Three.js artifact'}]}}
    const previousInputId=a.capability.token(s.id).id,changed=a.capability.observe(s,human)
    assert.equal(changed,'submitted');a.observeToolbox(s,human,{changed,previousInputId})
    assert.equal(a.toolboxStore.status({sessionId:s.id}).taskId,firstTask)
    const payload=JSON.stringify({taskToolbox:{version:'1',name:'workshop',entrypoint,project,operation:'capture',status:'ok',artifactVersion:'v1',feedbackRefs:[join(project,'capture.png')]}})
    for(const [kind,id]of [['native','n1'],['ptc','p1']]){
      const call={type:kind==='native'?'tool/call':'tool/ptc-dispatch-start',seq:4,data:{name:'bash',arguments:JSON.stringify({command:'node workshop.mjs capture'}),...(kind==='native'?{callId:id}:{subCallId:id})}}
      const result={type:kind==='native'?'tool/result':'tool/ptc-dispatch',seq:5,data:kind==='native'?{message:{toolCallId:id,content:[{type:'text',text:payload}]}}:{subCallId:id,content:[{type:'text',text:payload}]}}
      assert.equal(a.observeToolbox(s,call).ok,true);const got=a.observeToolbox(s,result);assert.equal(got.ok,true,JSON.stringify(got))
    }
    const snapshot=a.toolboxStore.status({sessionId:s.id});assert.equal(snapshot.entries[0].successCount,2)
    const context=await a.toolboxContextFor(s)
    assert.equal(context.taskTools[0].lastResult.callId,'p1');assert.equal(context.taskTools[0].lastResult.imageObserved,false)
    const working=a.getWorkingText(s.id)
    assert.ok(working.includes(entrypoint));assert.ok(working.includes('历史调用记录'));assert.ok(working.includes('v1'))
    assert.doesNotMatch(working,/已验证通过|图像已观察/)
    a.setIntentText(s.id,'User-edited packet without history',{reviewed:true})
    assert.equal(a.getWorkingText(s.id),'User-edited packet without history','never reinsert facts removed during review')
    await a.handleInput(s,{messageId:'next',text:'Keep refining',policy:{toolboxMode:'auto'},interpret:async()=>JSON.stringify(value({intent:{text:'Refine the same artifact',relation:'continue'}}))})
    assert.equal(a.toolboxStore.status({sessionId:s.id}).taskId,firstTask);assert.ok(a.getWorkingText(s.id).includes(entrypoint))
    const restored=fixture();restored.toolboxStore=createTaskToolboxStore({home,namespace:'runtime'})
    assert.ok(restored.getWorkingText(s.id).includes(entrypoint));assert.equal(restored.toolboxStore.status({sessionId:s.id}).entries[0].currentAvailability,'unknown')
    await a.handleInput(s,{messageId:'different',text:'Switch task',policy:{toolboxMode:'auto'},interpret:async()=>JSON.stringify(value({intent:{text:'A different task',relation:'new'}}))})
    assert.notEqual(a.toolboxStore.status({sessionId:s.id}).taskId,firstTask);assert.equal(a.getWorkingText(s.id).includes(entrypoint),false)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('turning off projections keeps tool history but does not ingest or expose new reports',async()=>{
 const a=fixture(),workspace=join(tmpdir(),'toolbox-switch-work'),s={id:'switch',header:{cwd:workspace}}
 await a.handleInput(s,{messageId:'m1',text:'task',policy:{toolboxMode:'auto'},interpret:async()=>JSON.stringify(value())})
 const token=a.toolboxStore.status({sessionId:s.id}).taskId
 a.policyNow=()=>({advisor:false,toolboxMode:'off'})
 assert.equal(a.observeToolbox(s,{type:'tool/call',data:{name:'bash',callId:'off',arguments:'{"command":"node workshop.mjs"}'}}).reason,'toolbox-off')
 assert.equal((await a.toolboxContextFor(s)).taskTools.length,0);assert.equal(a.getWorkingText(s.id),'')
 assert.equal(a.toolboxStore.status({sessionId:s.id}).taskId,token)
})
