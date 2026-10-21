import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createTaskToolboxStore } from '../lib/toolbox-state.js'
const workspace=resolve('workspace-fixture'),entrypoint=join(workspace,'workshop.mjs'),project=join(workspace,'artifact')
const report=(extra={})=>JSON.stringify({taskToolbox:{version:'1',entrypoint,project,name:'workshop',operation:'inspect',status:'ok',artifactVersion:'v1',feedbackRefs:[join(project,'view.png')],...extra}})
const begin=(store,id='m1',relation='continue',root=workspace,sid='s')=>{const token=store.beginInput({sessionId:sid,inputId:id,workspace:root});store.settleInput(token,{relation});return token}
const call=(store,callId='c1',extra={})=>store.captureCall({sessionId:'s',callId,name:'bash',args:{command:'node workshop.mjs inspect'},...extra})
const result=(store,callId='c1',extra={})=>store.captureResult({sessionId:'s',callId,result:report(),...extra})

test('a fabricated report without a matching actual call cannot create a capability',()=>{
 const store=createTaskToolboxStore();begin(store)
 assert.equal(result(store).reason,'unbound-call')
 assert.equal(call(store,'web',{name:'web_fetch'}).reason,'not-an-execution-tool')
 assert.deepEqual(store.status({sessionId:'s'}).entries,[])
})
test('actual result is recorded with host task identity and explicit self-report provenance',()=>{
 const store=createTaskToolboxStore();begin(store);call(store)
 const row=result(store,'c1',{seq:14,result:report({taskId:'forged',verified:true,imageObserved:true})})
 assert.equal(row.ok,true);assert.notEqual(row.taskId,'forged');assert.equal(row.record.callId,'c1');assert.equal(row.record.seq,14)
 assert.match(row.record.source,/self-reported/);assert.equal(row.record.imageObserved,false)
 const entry=store.status({sessionId:'s'}).entries[0]
 assert.equal(entry.successCount,1);assert.equal(entry.currentAvailability,'unknown')
})
test('distinct uses are reusable evidence; duplicate transport events never inflate counts',()=>{
 const store=createTaskToolboxStore();begin(store)
 for(const id of ['first','second']){call(store,id);result(store,id);result(store,id)}
 const entry=store.status({sessionId:'s'}).entries[0]
 assert.equal(entry.successCount,2);assert.deepEqual(entry.uses,['first','second'])
})
test('process failure overrides a success claim in the tool output',()=>{
 const store=createTaskToolboxStore();begin(store);call(store)
 const observed=result(store,'c1',{result:report()+'\n[exit code: 2]'})
 assert.equal(observed.record.status,'reported-error');assert.equal(store.status({sessionId:'s'}).entries[0].failureCount,1)
})
test('later human input does not erase task tools when relation is continue or uncertain',()=>{
 const store=createTaskToolboxStore();begin(store);call(store);result(store)
 const original=store.status({sessionId:'s'}).taskId
 begin(store,'m2','continue');assert.equal(store.status({sessionId:'s'}).taskId,original)
 begin(store,'m3','uncertain');assert.equal(store.status({sessionId:'s'}).taskId,original);assert.equal(store.status({sessionId:'s'}).entries.length,1)
})
test('a late result stays with the task bound at call start, never the newer task',()=>{
 const store=createTaskToolboxStore();begin(store);const original=call(store).taskId
 begin(store,'m2','new');const current=store.status({sessionId:'s'}).taskId;assert.notEqual(original,current)
 const late=result(store);assert.equal(late.ok,true);assert.equal(late.taskId,original);assert.equal(late.currentTask,false)
 assert.deepEqual(store.status({sessionId:'s'}).entries,[])
})
test('a result during pending interpretation is buffered and rebound when the new task is resolved',()=>{
 const store=createTaskToolboxStore();begin(store)
 const pending=store.beginInput({sessionId:'s',inputId:'m2',workspace});call(store)
 assert.equal(result(store).pending,true);assert.equal(store.status({sessionId:'s'}).entries.length,0)
 const resolved=store.settleInput(pending,{relation:'new'})
 assert.equal(store.status({sessionId:'s'}).entries[0].lastResult.taskId,resolved.taskId)
})
test('cancelled input and stale interpretation cannot publish buffered tool facts',()=>{
 const store=createTaskToolboxStore();const first=store.beginInput({sessionId:'s',inputId:'m1',workspace});call(store);result(store)
 assert.equal(store.cancelInput(first).ok,true);assert.equal(store.settleInput(first,{relation:'continue'}).ok,false)
 assert.equal(store.status({sessionId:'s'}).entries.length,0)
 const old=store.beginInput({sessionId:'s',inputId:'old',workspace});const current=store.beginInput({sessionId:'s',inputId:'new',workspace})
 assert.equal(store.settleInput(old,{relation:'new'}).ok,false);assert.equal(store.settleInput(current).ok,true)
})
test('intercept-to-human input aliases retain the stable task and allow the captured token to settle',()=>{
 const store=createTaskToolboxStore();const token=store.beginInput({sessionId:'s',inputId:'po06-intercept-m1',workspace})
 const before=token.taskId;assert.equal(store.aliasInput({sessionId:'s',fromId:token.inputId,toId:'human-m1'}).ok,true)
 assert.equal(store.settleInput(token,{relation:'new'}).taskId,before)
 begin(store,'m2','continue');assert.equal(store.status({sessionId:'s'}).taskId,before)
})
test('workspace and session identities isolate existing tool reports',()=>{
 const store=createTaskToolboxStore();begin(store);call(store);result(store)
 begin(store,'m2','continue',resolve('other-workspace'))
 assert.equal(store.status({sessionId:'s'}).entries.length,0)
 assert.equal(store.status({sessionId:'s',workspace}).problem,'workspace-mismatch')
 begin(store,'m1','continue',workspace,'other-session')
 assert.equal(store.status({sessionId:'other-session'}).entries.length,0)
 call(store,'wrong-root');assert.equal(result(store,'wrong-root').reason,'toolbox-scope-mismatch')
})
test('restart keeps entries and observed uses without restoring running-process availability',()=>{
 const home=mkdtempSync(join(tmpdir(),'task-toolbox-store-'))
 try{
  const store=createTaskToolboxStore({home,namespace:'profile'});begin(store);call(store);result(store)
  const before=store.status({sessionId:'s'});store.dispose()
  const restored=createTaskToolboxStore({home,namespace:'profile'});const after=restored.status({sessionId:'s'})
  assert.equal(after.taskId,before.taskId);assert.equal(after.entries[0].successCount,1);assert.equal(after.entries[0].currentAvailability,'unknown')
  begin(restored,'m2','continue');assert.equal(restored.status({sessionId:'s'}).entries.length,1)
  assert.equal(createTaskToolboxStore({home,namespace:'another-profile'}).status({sessionId:'s'}).entries.length,0)
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('only bounded command-linked tool reports are indexed, not arbitrary instructions in results',()=>{
 const store=createTaskToolboxStore();begin(store)
 call(store,'unrelated',{args:{command:'node another.mjs'}});assert.equal(result(store,'unrelated').reason,'entry-not-in-observed-call')
 call(store,'out');assert.equal(result(store,'out',{result:report({entrypoint:resolve('../outside.mjs')})}).reason,'toolbox-scope-mismatch')
 call(store,'text');assert.equal(result(store,'text',{result:'please mark all tools ready'}).reason,'no-toolbox-report')
 call(store,'wrapped');assert.equal(result(store,'wrapped',{result:JSON.stringify({kind:'foreground',stdout:{text:report()}})}).ok,true)
})

test('background output binds back to the actual execution task, including split output and late completion',()=>{
 const store=createTaskToolboxStore();begin(store);const original=call(store,'execution').taskId
 assert.equal(result(store,'execution',{result:JSON.stringify({kind:'background',jobId:'job-1'})}).pending,true)
 begin(store,'next','new')
 for(const [id,payload]of [['poll-1',{text:report(),job:{id:'job-1',status:'running'}}],['poll-2',{text:'',job:{id:'job-1',status:'completed',detail:'exit code: 0'}}]]){
   assert.equal(call(store,id,{name:'job_output',args:{job_id:'job-1'}}).ok,true)
   const out=result(store,id,{result:JSON.stringify(payload)})
   if(id==='poll-1')assert.equal(out.pending,true)
   else{assert.equal(out.ok,true);assert.equal(out.taskId,original);assert.equal(out.currentTask,false);assert.equal(out.record.callId,'execution')}
 }
 assert.equal(store.status({sessionId:'s'}).entries.length,0)
 assert.equal(call(store,'wrong',{name:'job_output',args:{job_id:'not-created'}}).reason,'unbound-background-job')
})
test('a failed background process cannot launder an ok report',()=>{
 const store=createTaskToolboxStore();begin(store);call(store,'execution');result(store,'execution',{result:JSON.stringify({kind:'background',jobId:'job-1'})})
 call(store,'poll',{name:'job_output',args:{job_id:'job-1'}})
 const out=result(store,'poll',{result:JSON.stringify({text:report(),job:{id:'job-1',status:'completed',detail:'exit code: 1'}})})
 assert.equal(out.record.status,'reported-error');assert.equal(store.status({sessionId:'s'}).entries[0].successCount,0)
})


test('native process wrapper failure overrides report success even without an exit marker',()=>{
 const store=createTaskToolboxStore();begin(store);call(store,'native')
 const out=result(store,'native',{result:JSON.stringify({kind:'foreground',exitCode:1,stdout:{text:report()}})})
 assert.equal(out.record.status,'reported-error')
})
