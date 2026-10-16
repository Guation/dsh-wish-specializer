import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createInferenceFocus} from '../lib/inference-focus.js'
const issue=(seq=5,kind='invocation-failure')=>({key:'a'.repeat(64),id:'E'+seq,kind,status:'open',operation:'b'.repeat(64),source:{id:'E'+seq,seq,callId:'call-'+seq,tool:'bash',requestId:'human:1'},label:'old operation failed',excerpt:'[exit code: 2]',pendingReason:'not-a-product-check'})
const snapshot=(issues=[issue()],requestId='human:1')=>({version:1,requestId,openIssues:issues,recentEvidence:[{id:'E8',excerpt:'new observation'}],mode:'diagnose',completionClaimAllowed:false})
const select=(f,e=snapshot(),sid='s')=>f.select({sessionId:sid,evidence:e})
test('a new actual invocation is offered once, only after explicit completed-worker acknowledgement',()=>{
 const f=createInferenceFocus(),e=snapshot(),before=JSON.stringify(e),a=select(f,e)
 assert.equal(a.evidence.mode,'diagnose');assert.equal(a.evidence.activeIssues.length,1)
 assert.equal(select(f,e).evidence.activeIssues.length,1,'selecting is not acknowledging')
 assert.equal(f.markDelivered(a.token).ok,true)
 const next=select(f,e).evidence;assert.equal(next.mode,'explore');assert.equal(next.activeIssues.length,0);assert.equal(next.retainedIncidents.length,1)
 assert.equal(next.openIssues[0].status,'open');assert.equal(next.completionClaimAllowed,false);assert.equal(JSON.stringify(e),before)
})
test('a new recurrence, session, or true user epoch is not hidden by earlier delivery',()=>{
 const f=createInferenceFocus();f.markDelivered(select(f).token)
 assert.equal(select(f,snapshot([issue(9)])).evidence.activeIssues.length,1)
 assert.equal(select(f,snapshot(),'other-session').evidence.activeIssues.length,1)
 assert.equal(select(f,snapshot([issue()],'human:20')).evidence.activeIssues.length,1)
})
test('unclosed product failures and omitted failure aggregates never disappear with invocation focus',()=>{
 const f=createInferenceFocus(),product=issue(7,'reported-failure'),omitted={kind:'omitted-reported-failures',status:'recheck-pending',count:4},e=snapshot([issue(),product,omitted])
 f.markDelivered(select(f,e).token);const next=select(f,e).evidence
 assert.equal(next.mode,'diagnose');assert.deepEqual(next.activeIssues,[product,omitted]);assert.equal(next.retainedIncidents.length,1)
})
test('failed/cancelled main streams can release focus without consuming it',()=>{
 const f=createInferenceFocus(),a=select(f);f.release(a.token)
 assert.equal(f.markDelivered(a.token).ok,false);assert.equal(select(f).evidence.activeIssues.length,1)
})
test('in-flight copies may both include new evidence but acknowledgements cannot affect a newer user request',()=>{
 const f=createInferenceFocus(),a=select(f),b=select(f)
 assert.equal(a.evidence.activeIssues.length,1);assert.equal(b.evidence.activeIssues.length,1)
 select(f,snapshot([],'human:9'));assert.equal(f.markDelivered(a.token).reason,'stale-focus-request')
})
test('unknown source identities stay active rather than gaining suppression authority',()=>{
 const f=createInferenceFocus(),i={...issue(),source:{id:'E999',seq:5}},a=select(f,snapshot([i]))
 assert.equal(a.token,null);assert.equal(a.evidence.activeIssues.length,1)
})
test('new real successes accompany focus but cannot close unrelated product failures',()=>{
 const f=createInferenceFocus(),e=snapshot([issue(7,'reported-failure')]);e.recentEvidence=[{id:'E10',excerpt:'PASS unrelated'}]
 const v=select(f,e).evidence;assert.equal(v.activeIssues.length,1);assert.deepEqual(v.recentEvidence,e.recentEvidence)
})
test('acknowledgements survive restart without becoming product-resolution or private text storage',t=>{
 const home=mkdtempSync(join(tmpdir(),'fast-focus-'));t.after(()=>rmSync(home,{recursive:true,force:true}))
 const f=createInferenceFocus({home,namespace:'test'});f.markDelivered(select(f).token);f.dispose()
 const restored=createInferenceFocus({home,namespace:'test'}),v=select(restored).evidence
 assert.equal(v.activeIssues.length,0);assert.equal(v.retainedIncidents.length,1);assert.equal(v.openIssues[0].status,'open')
 const file=join(home,'po06-inference-focus',readdirSync(join(home,'po06-inference-focus'))[0]);const text=readFileSync(join(file,readdirSync(file)[0]),'utf8')
 assert.doesNotMatch(text,/old operation failed|exit code|recentEvidence|private|reasoning/)
})
test('corrupt or changed persisted acknowledgements fail safe and report a limitation',t=>{
 const home=mkdtempSync(join(tmpdir(),'fast-focus-'));t.after(()=>rmSync(home,{recursive:true,force:true}))
 const f=createInferenceFocus({home});f.markDelivered(select(f).token)
 const dir=join(home,'po06-inference-focus',readdirSync(join(home,'po06-inference-focus'))[0]),file=join(dir,readdirSync(dir)[0]);writeFileSync(file,'{"payload":{}}')
 const v=select(createInferenceFocus({home})).evidence
 assert.equal(v.activeIssues.length,1);assert.ok(v.limitations.includes('focus-state-unavailable-or-corrupt'))
})
test('focus disposal and unsupported snapshots never infer a passing result',()=>{
 const f=createInferenceFocus();assert.equal(f.select({}).token,null);f.dispose();assert.equal(select(f).token,null)
 assert.equal(f.status().completionClaimAllowed,false)
})
