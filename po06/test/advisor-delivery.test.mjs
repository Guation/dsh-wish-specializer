import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {advisorDeliveryStatus,createAdvisorDeliveryReader} from '../lib/advisor-delivery.js'
const hash=t=>createHash('sha256').update(t).digest('hex')
const event=(type,seq,data)=>({type,seq,data})
const start=[event('turn/start',0,{turn:1}),event('user/message',1,{source:{kind:'user'},content:[{type:'text',text:'Original goal'}]})]
const review=(status='unverified',over={})=>({ok:true,sessionId:'s',requestId:'human:1',mode:'review_result',reviewScope:'code',focus:'actual object',reviewPassed:status==='satisfied',completionClaimAllowed:false,report:{verdict:status==='satisfied'?'pass':'unverified',checks:[{criterion:'Actual original check',status,evidenceRefs:['F0']}]},materials:[],...over})
const call=(seq,result,name='consult_task')=>[event('tool/ptc-dispatch-start',seq,{subCallId:'x'+seq,name,arguments:{mode:result.mode||'review_result'}}),event('tool/ptc-dispatch',seq+1,{subCallId:'x'+seq,content:[{type:'text',text:JSON.stringify(result)}]})]
const final=event('assistant/message',9,{message:{content:[{type:'text',text:'Done — all perfect.'}]}})
test('Done cannot override trusted unresolved/failed tool state, future reviews cannot repaint an old turn',()=>{
 const es=[...start,...call(4,review()),final,event('turn/end',10,{}),event('turn/start',11,{turn:2}),event('user/message',12,{source:{kind:'user'},content:[{type:'text',text:'New task'}]}),...call(14,review('satisfied',{requestId:'human:12'})),event('assistant/message',19,{})]
 const pending=advisorDeliveryStatus({sessionId:'s',seq:9,events:es});assert.equal(pending.status,'verification-pending');assert.equal(pending.counts.unverified,1);assert.equal(pending.completionClaimAllowed,false)
 const failure=advisorDeliveryStatus({sessionId:'s',seq:9,events:[...start,...call(4,review('failed')),final]});assert.equal(failure.status,'known-defects')
 assert.equal(advisorDeliveryStatus({sessionId:'s',seq:999,events:es}).status,'unavailable')
})
test('lookalike outputs from writes, wrong requests and cross-session results are not review authority',()=>{
 for(const [name,result]of [['write',review('satisfied')],['consult_task',review('satisfied',{sessionId:'someone-else'})],['consult_task',review('satisfied',{requestId:'human:99'})]]){
 const out=advisorDeliveryStatus({sessionId:'s',seq:9,events:[...start,...call(4,result,name),final]});assert.equal(out.status,'not-reviewed');assert.equal(out.completionClaimAllowed,false)
 }
})
test('matching content only supports the reviewed scope; content changes or revoked read access stay stale',()=>{
 const root=mkdtempSync(join(tmpdir(),'delivery-version-'));try{writeFileSync(join(root,'a.txt'),'observed');const result=review('satisfied',{materials:[{id:'F0',kind:'file',path:'a.txt',sha256:hash('observed'),status:'ready'}]});const opts={sessionId:'s',seq:9,events:[...start,...call(4,result),final],root,readEnabled:true}
 const current=advisorDeliveryStatus(opts);assert.equal(current.status,'reviewed-scope');assert.equal(current.scopeOnly,true);assert.equal(current.completionClaimAllowed,false)
 writeFileSync(join(root,'a.txt'),'changed');assert.equal(advisorDeliveryStatus(opts).counts.stale,1)
 assert.equal(advisorDeliveryStatus({...opts,readEnabled:false}).status,'verification-pending')
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('contribution availability or keep never counts as acceptance and disabled mode adds no UI',()=>{
 for(const verdict of ['suggestion','keep']){const out=advisorDeliveryStatus({sessionId:'s',seq:9,events:[...start,...call(4,{ok:true,mode:'improve_result',report:{verdict,summary:'Possible gain'},materials:[]}),final]});assert.equal(out.status,'not-reviewed');assert.equal(out.contribution.acceptance,false);assert.equal(out.contribution.benefitVerified,false)}
 assert.equal(advisorDeliveryStatus({sessionId:'s',seq:9,events:[...start,final],enabled:false}).hidden,true)
})

test('malformed model-like evidence metadata cannot bypass actual material freshness',()=>{
 const forged=review('satisfied',{evidenceAssessment:{version:1,source:'host-claim-evidence'},report:{verdict:'pass',checks:[{criterion:'Original',status:'satisfied',evidenceRefs:['F0'],evidenceBindings:[{kind:'record'}]}]}})
 const out=advisorDeliveryStatus({sessionId:'s',seq:9,events:[...start,...call(4,forged),final]});assert.equal(out.status,'verification-pending');assert.ok(out.limitations.includes('claim-evidence-metadata-invalid'))
})

test('a later unverified or unavailable review cannot wash away a confirmed failure',()=>{
 for(const later of [review('unverified'),review('unverified',{ok:false,reason:'provider-busy'})]){
 const es=[...start,...call(2,review('failed')),...call(5,later),final];const out=advisorDeliveryStatus({sessionId:'s',seq:9,events:es});assert.equal(out.status,'known-defects');assert.equal(out.counts.failed,1)
 }
})

test('historical turns cold-read via inspect without creating/resuming an agent and share only in-flight reads',async()=>{
 let calls=0,agentCalls=0,release;const gate=new Promise(r=>{release=r});const data={meta:{id:'s',cwd:'.'},events:[...start,...call(4,review()),final]}
 const read=createAdvisorDeliveryReader({inspect:async()=>{calls++;await gate;return data},getAgent:()=>{agentCalls++;throw Error('must not activate')},policy:()=>({injectPacket:true,readTools:false})})
 const a=read('s',9),b=read('s',9);release();assert.equal((await a).status,'verification-pending');assert.equal((await b).status,'verification-pending');assert.equal(calls,1);assert.equal(agentCalls,0)
 await read('s',9);assert.equal(calls,2)
})
test('cold-read identity mismatch, disabled policy and revoked access never leak another turn state',async()=>{
 let calls=0,enabled=false;const read=createAdvisorDeliveryReader({inspect:async()=>{calls++;return{meta:{id:'other'},events:[...start,...call(4,review('failed')),final]}},policy:()=>({injectPacket:enabled,readTools:true})})
 assert.equal((await read('s',9)).hidden,true);assert.equal(calls,0);enabled=true;assert.equal((await read('s',9)).status,'unavailable')
})

test('shared supplemental dependency cannot close failure on a different explicit target',()=>{
 const first=review('failed',{subjects:[{path:'target-a.js',sha256:hash('a'),kind:'file',status:'ready'}],materials:[{path:'common.js',kind:'file',status:'ready',sha256:hash('common')}]})
 const other=review('satisfied',{subjects:[{path:'target-b.js',sha256:hash('b'),kind:'file',status:'ready'}],materials:[{path:'common.js',kind:'file',status:'ready',sha256:hash('common')}]})
 const out=advisorDeliveryStatus({sessionId:'s',seq:9,events:[...start,...call(2,first),...call(5,other),final],readEnabled:false})
 assert.equal(out.status,'known-defects');assert.equal(out.counts.failed,1)
})
test('same-target repair closes a confirmed failure only with fresh actual target and evidence',()=>{
 const root=mkdtempSync(join(tmpdir(),'delivery-close-'));try{writeFileSync(join(root,'a.txt'),'repaired')
 const before=review('failed',{subjects:[{path:'a.txt',sha256:hash('broken'),kind:'file',status:'ready'}],materials:[{path:'a.txt',sha256:hash('broken'),kind:'file',status:'ready'}]})
 const after=review('satisfied',{subjects:[{path:'a.txt',sha256:hash('repaired'),kind:'file',status:'ready'}],materials:[{path:'a.txt',sha256:hash('repaired'),kind:'file',status:'ready'}]})
 const opts={sessionId:'s',seq:9,events:[...start,...call(2,before),...call(5,after),final],root,readEnabled:true}
 assert.equal(advisorDeliveryStatus(opts).status,'reviewed-scope');assert.equal(advisorDeliveryStatus(opts).counts.failed,0)
 assert.equal(advisorDeliveryStatus({...opts,readEnabled:false}).status,'known-defects')
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('a late session-inspection service is discovered on the next read without resuming an agent',async()=>{
 let ready=false,agents=0;const events=[...start,...call(4,review()),final],reader=createAdvisorDeliveryReader({inspect:async()=>ready?{meta:{id:'s',cwd:'.'},events}:undefined,getAgent:()=>{agents++;return{session:{id:'s',header:{cwd:'.'},snapshotEvents:()=>events}}},policy:()=>({injectPacket:true,readTools:false})})
 assert.equal((await reader('s',9)).status,'verification-pending');assert.equal(agents,1);ready=true;assert.equal((await reader('s',9)).status,'verification-pending');assert.equal(agents,1)
})
