import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {assessReviewEvidence, claimEvidenceState, evidencePathIdentity, CLAIM_EVIDENCE_POLICY} from '../lib/advisor-evidence.js'
import {createAdvisorStages} from '../lib/advisor-stages.js'
import {createAdvisorCoverage, coverageFor} from '../lib/advisor-coverage.js'

const hash=value=>createHash('sha256').update(value).digest('hex')
const clone=value=>JSON.parse(JSON.stringify(value))
const material=(path='a.js',body='alpha\nbeta\ngamma\n',overrides={})=>({id:'F0',path,kind:'file',status:'ready',sent:true,sha256:hash(body),selectionScope:'line-range',selectionComplete:true,wholeFileComplete:false,selectedStartLine:2,selectedEndLine:2,...overrides})
const read=(path='a.js',body='alpha\nbeta\ngamma\n',overrides={})=>({tool:'read',args:{path,startLine:2,endLine:2},ok:true,resultAvailable:true,evidence:{ref:'read:'+path,path,kind:'file',status:'ready',sha256:hash(body),selectionComplete:true,wholeFileComplete:false,startLine:2,endLine:2,...overrides}})
const image=(overrides={})=>({id:'I0',path:'view.png',kind:'image',status:'ready',sent:true,sha256:hash('pixels'),image:{mediaType:'image/png',width:200,height:100},evidenceType:'other',...overrides})
const report=(refs=['F0'],status='satisfied')=>({verdict:status==='satisfied'?'pass':status==='failed'?'gaps':'unverified',summary:'bounded claim',findings:[],checks:[{criterion:'selected behavior',status,evidenceRefs:refs}],nextStep:'inspect current evidence',stopCondition:'stop after scoped review'})
const options=(root,materials=[],trace=[],extra={})=>({root,materials,trace,resultIds:new Set([...materials.map(m=>m.id),...trace.filter(r=>r.resultAvailable).map(r=>'read:'+r.args.path)]),...extra})
const fixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'claim-evidence-'))
 writeFileSync(join(root,'a.js'),'alpha\nbeta\ngamma\n');writeFileSync(join(root,'b.js'),'bravo');writeFileSync(join(root,'extra.js'),'extra');writeFileSync(join(root,'view.png'),'pixels')
 return {root,cleanup:()=>rmSync(root,{recursive:true,force:true})}
}
const stageFixture=(root,criteria=['A behavior','B behavior'],scope='code',subjectPaths=[])=>{
 const store=createAdvisorStages({home:join(root,'stage-store')}),ctx={sessionId:'s',root,readEnabled:true}
 const task=store.startTask({...ctx,title:'bounded task',sourceRequestId:'human:1',sourceText:'review selected behavior'})
 const declared=store.defineStage({...ctx,taskId:task.taskId,scope,focus:'bounded object',criteria,subjectPaths})
 assert.equal(declared.ok,true)
 const target={...ctx,taskId:task.taskId,stageId:declared.stage.id}
 const stageReport=(refs,statuses=criteria.map(()=>'satisfied'))=>({...report(),verdict:statuses.some(s=>s==='failed')?'gaps':statuses.every(s=>s==='satisfied')?'pass':'unverified',checks:declared.stage.checks.map((c,i)=>({checkId:c.id,criterion:c.criterion,status:statuses[i],evidenceRefs:refs[i]}))})
 return {store,ctx,target,declared,stageReport}
}
const recordCoverage=(store,assessment,extra={})=>store.record({sessionId:'s',requestId:'q',runId:'r',scope:'code',focus:'bounded behavior',revisionMarker:'write:1',materials:assessment.materials,report:assessment.report,ok:true,partial:false,...extra})
const coverageOptions=root=>({sessionId:'s',requestId:'q',root,readEnabled:true,revisionMarker:'write:1',requiredReviews:[{scope:'code',focus:'bounded behavior'}]})

test('host assessment overwrites model escape fields and returns the exact public shape',()=>{
 const r=report();r.evidenceAssessment={complete:true,skipMissing:true};r.checks[0].evidenceBindings=[{supported:true,fake:true}]
 const got=assessReviewEvidence(r,options('C:/work',[material('a.js',undefined,{status:'truncated',selectionComplete:false})]))
 assert.strictEqual(got.report,r)
 assert.deepEqual(Object.keys(got).sort(),['report','materials','evidenceGaps','supplementalWarnings','complete','bindings'].sort())
 assert.equal(got.complete,false);assert.equal(r.verdict,'unverified');assert.equal(r.checks[0].status,'unverified')
 assert.equal(r.evidenceAssessment.source,'host-claim-evidence');assert.equal('skipMissing' in r.evidenceAssessment,false)
 assert.equal('fake' in r.checks[0].evidenceBindings[0],false)
 assert.equal(claimEvidenceState(r).policy,CLAIM_EVIDENCE_POLICY)
})

test('complete targeted read is separate from uncited clipped F0 at the identical path',()=>{
 const clipped=material('a.js',undefined,{status:'truncated',selectionComplete:false}),raw=read()
 const got=assessReviewEvidence(report(['read:a.js']),options('C:/work',[clipped],[raw]))
 assert.equal(got.complete,true);assert.equal(got.report.verdict,'pass');assert.equal(got.report.checks[0].status,'satisfied')
 assert.equal(got.materials[0].status,'truncated');assert.equal(got.evidenceGaps.length,0);assert.equal(got.supplementalWarnings.length,1)
 assert.deepEqual(got.report.checks[0].evidenceBindings[0].ranges,[{startLine:2,endLine:2}])
 assert.equal(got.report.checks[0].evidenceBindings[0].wholeFileComplete,false)
 assert.equal(claimEvidenceState(got.report).complete,true)
})

test('citing clipped F0 remains blocked even alongside a complete read of that file',()=>{
 const got=assessReviewEvidence(report(['F0','read:a.js']),options('C:/work',[material('a.js',undefined,{status:'truncated',selectionComplete:false})],[read()]))
 assert.equal(got.complete,false);assert.equal(got.report.checks[0].status,'unverified')
 assert.ok(got.evidenceGaps.some(g=>g.ref==='F0' && g.reason==='cited-evidence-truncated'))
})

test('unrelated partial/missing materials and incomplete reads are supplemental, not vetoes',()=>{
 const rows=[material(),material('extra.js','extra',{id:'F1',status:'truncated',selectionComplete:false}),{id:'F2',path:'missing.txt',kind:'file',status:'unavailable'}]
 const got=assessReviewEvidence(report(),options('C:/work',rows,[read('unrelated.js','x',{status:'truncated',selectionComplete:false})]))
 assert.equal(got.complete,true);assert.equal(got.evidenceGaps.length,0);assert.equal(got.supplementalWarnings.length,3)
})

test('cited partial, unknown-completeness and unavailable evidence cannot support satisfaction',()=>{
 for(const change of [{status:'truncated',selectionComplete:false},{partial:true},{selectionComplete:undefined},{sent:false},{sha256:null},{status:'unavailable'}]) {
  const got=assessReviewEvidence(report(),options('C:/work',[material('a.js',undefined,change)]))
  assert.equal(got.complete,false,JSON.stringify(change));assert.equal(got.report.checks[0].status,'unverified')
 }
 const failed=assessReviewEvidence(report(['F0'],'failed'),options('C:/work',[material('a.js',undefined,{status:'truncated',selectionComplete:false})]))
 assert.equal(failed.report.checks[0].status,'failed');assert.equal(failed.report.verdict,'gaps')
})

test('canonical identity is root-aware and has no basename or suffix authority',()=>{
 assert.equal(evidencePathIdentity('lib/../a.js','C:/WORK'),'a.js')
 assert.equal(evidencePathIdentity('c:\\work\\LIB\\a.js','C:/WORK'),'lib/a.js')
 assert.equal(evidencePathIdentity('../outside.js','C:/work'),null)
 assert.equal(evidencePathIdentity('C:relative.js','C:/work'),null)
 assert.equal(evidencePathIdentity('C:/else/a.js','C:/work'),null)
 for(const ref of ['read:a.js','read:sub/lib/a.js','read:liba.js','read:../lib/a.js']) {
  const got=assessReviewEvidence(report([ref]),options('C:/work',[],[read('lib/a.js')]))
  assert.equal(got.complete,false,ref)
 }
 const absolute=assessReviewEvidence(report(['read:C:\\WORK\\lib\\a.js']),options('C:/work',[],[read('lib/a.js')]))
 assert.equal(absolute.complete,true)
})

test('same path with differing raw-read hashes, including case-fold aliases, is ambiguous',()=>{
 for(const [root,paths] of [['C:/work',['a.js','./a.js']],['C:/work',['A.js','a.js']]]) {
  const got=assessReviewEvidence(report(['read:a.js']),options(root,[],[read(paths[0],'old'),read(paths[1],'new')]))
  assert.equal(got.complete,false);assert.equal(got.bindings[0].status,'ambiguous')
 }
 const got=assessReviewEvidence(report(['F0','read:a.js']),options('C:/work',[material('a.js','old')],[read('a.js','new')]))
 assert.equal(got.complete,false);assert.ok(got.bindings.every(b=>b.status==='ambiguous'))
})

test('unqualified raw read alias with mixed clipped/complete calls is ambiguous even at one hash',()=>{
 const got=assessReviewEvidence(report(['read:a.js']),options('C:/work',[],[read('a.js',undefined,{status:'truncated',selectionComplete:false}),read()]))
 assert.equal(got.complete,false);assert.equal(got.bindings[0].status,'ambiguous')
 const multipleComplete=assessReviewEvidence(report(['read:a.js']),options('C:/work',[],[read(),read('a.js',undefined,{startLine:3,endLine:3})]))
 assert.equal(multipleComplete.complete,true);assert.equal(multipleComplete.bindings[0].ranges.length,2)
})

test('merged read materials never substitute for raw trace provenance',()=>{
 const aggregate=material('a.js',undefined,{id:'read:a.js',source:'advisor-read'})
 const got=assessReviewEvidence(report(['read:a.js']),options('C:/work',[aggregate]))
 assert.equal(got.complete,false)
 const missingMetadata=read();delete missingMetadata.evidence.sha256
 const mixed=assessReviewEvidence(report(['read:a.js']),options('C:/work',[],[missingMetadata,read()]))
 assert.equal(mixed.complete,false);assert.equal(mixed.bindings[0].status,'ambiguous')
})

test('E authority requires actual resultIds and a matching complete tool/result record',()=>{
 const row={id:'E8',type:'tool/result',name:'test_run',text:'actual bounded test result'}
 const good=assessReviewEvidence(report(['E8']),{root:'C:/work',resultIds:new Set(['E8']),records:[row]})
 assert.equal(good.complete,true);assert.equal(good.bindings[0].source,'tool-result')
 for(const changes of [{resultIds:new Set()},{records:[]},{records:[{...row,type:'tool/call'}]},{records:[{...row,partial:true}]},{records:[{...row,text:'head\n[截断：原 99999 字符]'}]}]) {
  const got=assessReviewEvidence(report(['E8']),{root:'C:/work',resultIds:new Set(['E8']),records:[row],...changes})
  assert.equal(got.complete,false)
 }
})

test('visual satisfaction needs a cited ready actual image, never declaration-only source/runtime evidence',()=>{
 const source=material('a.js',undefined,{evidenceType:'runtime-capture'})
 const actual=image()
 const sourceOnly=assessReviewEvidence(report(),options('C:/work',[source,actual],[],{visual:true}))
 assert.equal(sourceOnly.complete,false);assert.ok(sourceOnly.evidenceGaps.some(g=>g.reason==='cited-actual-image-required'))
 for(const bad of [{status:'not-inspected',reason:'model-image-capability-unknown'},{sent:false},{image:undefined},{image:{mediaType:'image/svg+xml',width:1,height:1}},{evidenceType:'reference'}]) {
  const got=assessReviewEvidence(report(['I0']),options('C:/work',[image(bad)],[],{visual:true}))
  assert.equal(got.complete,false,JSON.stringify(bad))
 }
 const missing=assessReviewEvidence(report(['I0']),{root:'C:/work',visual:true,resultIds:new Set(['I0'])})
 assert.equal(missing.complete,false)
 const runtime=assessReviewEvidence(report(['E9']),{root:'C:/work',visual:true,resultIds:new Set(['E9']),records:[{id:'E9',type:'tool/result',name:'screenshot',text:'runtime-capture completed'}]})
 assert.equal(runtime.complete,false)
 const actualCited=assessReviewEvidence(report(['I0','F0']),options('C:/work',[source,actual],[],{visual:true}))
 assert.equal(actualCited.complete,true);assert.equal(claimEvidenceState(actualCited.report).complete,true)
 const withReference=assessReviewEvidence(report(['I0','I1']),options('C:/work',[actual,image({id:'I1',path:'reference.png',evidenceType:'reference'})],[],{visual:true}))
 assert.equal(withReference.complete,true)
})

test('host metadata is deterministic and incompatible/corrupt metadata never becomes legacy',()=>{
 const opts=options('C:/work',[material()]),first=assessReviewEvidence(report(),opts),second=assessReviewEvidence(report(),opts)
 assert.deepEqual(first.report,second.report)
 for(const mutate of [r=>r.evidenceAssessment.version=2,r=>r.evidenceAssessment.complete=false,r=>r.checks[0].evidenceBindings[0]=null,r=>r.checks[0].evidenceBindings[0].sha256=hash('fake'),r=>delete r.evidenceAssessment]) {
  const corrupted=clone(first.report);mutate(corrupted)
  assert.equal(claimEvidenceState(corrupted).policy,'invalid')
 }
 assert.equal(claimEvidenceState(report()).policy,'legacy')
})

test('claim stage reload survives clipped F0 and only stale-checks changed or invalidated bound paths',()=>{
 const f=fixture();try {
  const s=stageFixture(f.root),rows=[material('a.js',undefined,{status:'truncated',selectionComplete:false}),material('b.js','bravo',{id:'F1'}),material('extra.js','extra',{id:'F2',status:'truncated',selectionComplete:false})]
  const prepared=s.store.prepareReview({...s.target,materials:rows,evidencePolicy:CLAIM_EVIDENCE_POLICY})
  assert.equal(prepared.ok,true);assert.deepEqual(prepared.subjects,[])
  const got=assessReviewEvidence(s.stageReport([['read:a.js'],['F1']]),options(f.root,rows,[read()]))
  assert.equal(s.store.recordReview({...s.target,reviewId:'r1',report:got.report,materials:got.materials,subjects:prepared.subjects,attemptId:prepared.attemptId}).ok,true)
  const reloaded=createAdvisorStages({home:join(f.root,'stage-store')})
  assert.equal(reloaded.advance(s.target).ok,true);assert.deepEqual(reloaded.status(s.ctx).stage.evidenceAssessment,got.report.evidenceAssessment)
  writeFileSync(join(f.root,'extra.js'),'unrelated update')
  assert.equal(reloaded.invalidate({...s.ctx,path:'extra.js'}).invalidatedStages,0)
  assert.equal(reloaded.advance(s.target).ok,true)
  assert.equal(reloaded.invalidate({...s.ctx,path:join(f.root,'a.js')}).invalidatedStages,1)
  assert.deepEqual(reloaded.status(s.ctx).stage.checks.map(c=>c.status),['stale','satisfied'])
  writeFileSync(join(f.root,'a.js'),'changed')
  assert.deepEqual(createAdvisorStages({home:join(f.root,'stage-store')}).status(s.ctx).stage.checks.map(c=>c.status),['stale','satisfied'])
 }finally{f.cleanup()}
})

test('explicit visual subjectPaths still bind actual target hashes while uncited extras do not',()=>{
 const f=fixture();try {
  const s=stageFixture(f.root,['visible surface'],'appearance',['a.js']),rows=[image(),material('extra.js','extra',{status:'truncated',selectionComplete:false})]
  const prepared=s.store.prepareReview({...s.target,materials:rows,evidencePolicy:CLAIM_EVIDENCE_POLICY})
  assert.equal(prepared.subjects.length,1);assert.equal(prepared.subjects[0].sha256,hash('alpha\nbeta\ngamma\n'))
  const got=assessReviewEvidence(s.stageReport([['I0']]),options(f.root,rows,[],{visual:true}))
  assert.equal(s.store.recordReview({...s.target,reviewId:'r1',report:got.report,materials:rows,subjects:prepared.subjects,attemptId:prepared.attemptId}).ok,true)
  const reloaded=createAdvisorStages({home:join(f.root,'stage-store')})
  assert.equal(reloaded.advance(s.target).ok,true)
  writeFileSync(join(f.root,'extra.js'),'extra changed');assert.equal(reloaded.advance(s.target).ok,true)
  writeFileSync(join(f.root,'a.js'),'target changed');assert.equal(reloaded.advance(s.target).ok,false)
  assert.ok(reloaded.status(s.ctx).stage.limitations.includes('evidence-changed'))
 }finally{f.cleanup()}
})

test('partial/incomplete re-review and incompatible stage metadata cannot erase known failures',()=>{
 const f=fixture();try {
  const s=stageFixture(f.root,['known failed behavior']),rows=[material()]
  const failed=assessReviewEvidence(s.stageReport([['F0']],['failed']),options(f.root,rows))
  s.store.recordReview({...s.target,reviewId:'r1',report:failed.report,materials:rows,partial:true})
  assert.equal(s.store.status(s.ctx).stage.checks[0].status,'failed')
  const pending=assessReviewEvidence(s.stageReport([['F0']],['unverified']),options(f.root,rows))
  s.store.recordReview({...s.target,reviewId:'r2',report:pending.report,materials:rows})
  assert.equal(s.store.status(s.ctx).stage.checks[0].status,'failed')
  const persisted=s.store.archive(s.ctx);persisted.tasks[0].stages[0].evidenceAssessment.version=99
  writeFileSync(join(f.root,'stage-store','po06-advisor-stages','s.json'),JSON.stringify(persisted))
  const reloaded=createAdvisorStages({home:join(f.root,'stage-store')})
  assert.equal(reloaded.status(s.ctx).stage.checks[0].status,'failed');assert.equal(reloaded.advance(s.target).ok,false)
  assert.ok(reloaded.status(s.ctx).stage.limitations.includes('claim-evidence-metadata-invalid'))
 }finally{f.cleanup()}
})

test('coverage metadata reload binds only cited claim targets, not unrelated files or global markers',async()=>{
 const f=fixture();try {
  const rows=[material('a.js',undefined,{status:'truncated',selectionComplete:false}),material('extra.js','extra',{id:'F1',status:'truncated',selectionComplete:false})]
  const got=assessReviewEvidence(report(['read:a.js']),options(f.root,rows,[read()])),home=join(f.root,'coverage-store')
  const store=createAdvisorCoverage({home});assert.equal(recordCoverage(store,got).ok,true)
  const reloaded=createAdvisorCoverage({home}),opts=coverageOptions(f.root)
  const current=await coverageFor(reloaded,{...opts,revisionMarker:'write:unrelated'})
  assert.equal(current.rows[0].verdict,'pass');assert.equal(current.rows[0].status,'current')
  assert.deepEqual(current.rows[0].evidenceAssessment,got.report.evidenceAssessment)
  assert.deepEqual(current.rows[0].checks[0].evidenceBindings,got.report.checks[0].evidenceBindings)
  assert.equal(reloaded.feedback({sessionId:'s',root:f.root,readEnabled:true,revisionMarker:'write:unrelated'}).openIssues.length,0)
  writeFileSync(join(f.root,'extra.js'),'unrelated changed');assert.equal((await coverageFor(reloaded,opts)).rows[0].verdict,'pass')
  writeFileSync(join(f.root,'a.js'),'target changed');const changed=await coverageFor(reloaded,opts)
  assert.equal(changed.rows[0].status,'changed');assert.equal(changed.rows[0].checks[0].status,'unverified');assert.equal(changed.rows[0].verdict,'unverified')
  assert.equal((await coverageFor(reloaded,{...opts,readEnabled:false})).rows[0].verdict,'unverified')
 }finally{f.cleanup()}
})

test('coverage invalidation is per check, with aggregate pass blocked by any stale bound claim',async()=>{
 const f=fixture();try {
  const r=report();r.checks.push({criterion:'B behavior',status:'satisfied',evidenceRefs:['F1']})
  const rows=[material(),material('b.js','bravo',{id:'F1'})],got=assessReviewEvidence(r,options(f.root,rows)),store=createAdvisorCoverage()
  recordCoverage(store,got);writeFileSync(join(f.root,'a.js'),'changed')
  const current=await coverageFor(store,coverageOptions(f.root))
  assert.equal(current.rows[0].verdict,'unverified');assert.deepEqual(current.rows[0].checks.map(c=>c.status),['unverified','satisfied'])
 }finally{f.cleanup()}
})

test('legacy coverage retains conservative all-material and global-marker freshness',async()=>{
 const f=fixture();try {
  const store=createAdvisorCoverage(),rows=[material(),material('extra.js','extra',{id:'F1'})]
  store.record({sessionId:'s',requestId:'q',runId:'legacy',scope:'code',focus:'bounded behavior',revisionMarker:'write:1',materials:rows,report:report(),ok:true,partial:false})
  assert.equal((await coverageFor(store,coverageOptions(f.root))).rows[0].verdict,'pass')
  assert.equal((await coverageFor(store,{...coverageOptions(f.root),revisionMarker:'write:2'})).rows[0].verdict,'unverified')
  writeFileSync(join(f.root,'extra.js'),'changed');assert.equal((await coverageFor(store,coverageOptions(f.root))).rows[0].verdict,'unverified')
 }finally{f.cleanup()}
})

test('opaque E-result coverage keeps global revision provenance instead of claiming path-local freshness',async()=>{
 const f=fixture();try {
  const got=assessReviewEvidence(report(['E5']),{root:f.root,resultIds:new Set(['E5']),records:[{id:'E5',type:'tool/result',text:'bounded test output'}]})
  const store=createAdvisorCoverage();recordCoverage(store,got)
  assert.equal((await coverageFor(store,coverageOptions(f.root))).rows[0].verdict,'pass')
  assert.equal((await coverageFor(store,{...coverageOptions(f.root),revisionMarker:'write:2'})).rows[0].verdict,'unverified')
 }finally{f.cleanup()}
})

test('claim visual stage rejects only cited reused images, not an uncited old image supplement',()=>{
 const f=fixture();try {
  const s=stageFixture(f.root,['surface'],'appearance',['a.js']),old=image()
  const first=s.store.prepareReview({...s.target,materials:[old],evidencePolicy:CLAIM_EVIDENCE_POLICY})
  const initial=assessReviewEvidence(s.stageReport([['I0']]),options(f.root,[old],[],{visual:true}))
  assert.equal(s.store.recordReview({...s.target,reviewId:'r1',report:initial.report,materials:[old],subjects:first.subjects,attemptId:first.attemptId}).ok,true)
  writeFileSync(join(f.root,'a.js'),'source changed');writeFileSync(join(f.root,'new.png'),'new pixels')
  const fresh=image({id:'I1',path:'new.png',sha256:hash('new pixels')})
  const retry=s.store.prepareReview({...s.target,materials:[old,fresh],evidencePolicy:CLAIM_EVIDENCE_POLICY})
  assert.equal(retry.subjectProblem,null)
  const replay=assessReviewEvidence(s.stageReport([['I0']]),options(f.root,[old,fresh],[],{visual:true}))
  assert.equal(s.store.recordReview({...s.target,reviewId:'r2',report:replay.report,materials:[old,fresh],subjects:retry.subjects,attemptId:retry.attemptId}).reason,'visual-evidence-stale-after-subject-change')
  const next=s.store.prepareReview({...s.target,materials:[old,fresh],evidencePolicy:CLAIM_EVIDENCE_POLICY})
  const citedFresh=assessReviewEvidence(s.stageReport([['I1']]),options(f.root,[old,fresh],[],{visual:true}))
  assert.equal(s.store.recordReview({...s.target,reviewId:'r3',report:citedFresh.report,materials:[old,fresh],subjects:next.subjects,attemptId:next.attemptId}).ok,true)
  assert.equal(s.store.advance(s.target).ok,true)
 }finally{f.cleanup()}
})

test('corrupt targeted invalidation metadata blocks advance without dropping failed checks',()=>{
 const f=fixture();try {
  const s=stageFixture(f.root),rows=[material(),material('b.js','bravo',{id:'F1'})]
  const got=assessReviewEvidence(s.stageReport([['F0'],['F1']],['failed','satisfied']),options(f.root,rows))
  s.store.recordReview({...s.target,reviewId:'r1',report:got.report,materials:rows})
  const state=s.store.archive(s.ctx);state.tasks[0].stages[0].invalidatedChecks={bad:true}
  writeFileSync(join(f.root,'stage-store','po06-advisor-stages','s.json'),JSON.stringify(state))
  const reloaded=createAdvisorStages({home:join(f.root,'stage-store')})
  assert.deepEqual(reloaded.status(s.ctx).stage.checks.map(c=>c.status),['failed','stale'])
  assert.equal(reloaded.advance(s.target).ok,false)
 }finally{f.cleanup()}
})

test('explicit coverage subjects bind image claims to target hashes and reject reused cited pixels after changes',async()=>{
 const f=fixture();try {
  const home=join(f.root,'coverage-store'),store=createAdvisorCoverage({home}),rows=[image(),material('extra.js','extra',{status:'truncated',selectionComplete:false})]
  const got=assessReviewEvidence(report(['I0']),options(f.root,rows,[],{visual:true}))
  const subjects=[{path:'a.js',kind:'file',status:'ready',sha256:hash('alpha\nbeta\ngamma\n')}]
  assert.equal(recordCoverage(store,got,{scope:'appearance',subjects}).ok,true)
  const opts={...coverageOptions(f.root),requiredReviews:[{scope:'appearance',focus:'bounded behavior'}]}
  const reloaded=createAdvisorCoverage({home})
  assert.equal((await coverageFor(reloaded,opts)).rows[0].verdict,'pass')
  writeFileSync(join(f.root,'extra.js'),'extra changed');assert.equal((await coverageFor(reloaded,opts)).rows[0].verdict,'pass')
  writeFileSync(join(f.root,'a.js'),'actual target changed')
  const stale=await coverageFor(reloaded,opts)
  assert.equal(stale.rows[0].verdict,'unverified');assert.equal(stale.rows[0].subjects[0].verification,'changed')
  const changed=[{...subjects[0],sha256:hash('actual target changed')}]
  for(const runId of ['r2','r3'])assert.equal(recordCoverage(reloaded,got,{runId,scope:'appearance',subjects:changed}).reason,'visual-evidence-stale-after-subject-change')
  const next=image({sha256:hash('fresh pixels')});writeFileSync(join(f.root,'view.png'),'fresh pixels')
  const fresh=assessReviewEvidence(report(['I0']),options(f.root,[next],[],{visual:true}))
  assert.equal(recordCoverage(reloaded,fresh,{runId:'r4',scope:'appearance',subjects:changed}).ok,true)
  assert.equal((await coverageFor(reloaded,opts)).rows[0].verdict,'pass')
  const file=join(home,'po06-advisor-coverage.json'),persisted=JSON.parse(readFileSync(file,'utf8'))
  persisted.at(-1).subjectBindings.version=99;writeFileSync(file,JSON.stringify(persisted))
  const corrupt=await coverageFor(createAdvisorCoverage({home}),opts)
  assert.equal(corrupt.rows[0].verdict,'unverified');assert.ok(corrupt.limitations.some(x=>x.startsWith('coverage-subject-metadata-invalid')))
 }finally{f.cleanup()}
})

test('legacy empty subjects remain compatible across repeated store reload and persistence',async()=>{
 const f=fixture();try {
  const home=join(f.root,'coverage-store'),store=createAdvisorCoverage({home})
  store.record({sessionId:'s',requestId:'q',runId:'r1',scope:'code',focus:'bounded behavior',materials:[material()],report:report(),ok:true,partial:false})
  const file=join(home,'po06-advisor-coverage.json'),original=JSON.parse(readFileSync(file,'utf8'))
  delete original[0].subjects;delete original[0].subjectBindings;writeFileSync(file,JSON.stringify(original))
  const reloaded=createAdvisorCoverage({home})
  reloaded.record({sessionId:'other',requestId:'q',runId:'r2',scope:'code',focus:'bounded behavior',materials:[],report:report(),ok:true,partial:false})
  assert.equal((await coverageFor(createAdvisorCoverage({home}),{...coverageOptions(f.root),revisionMarker:undefined})).rows[0].verdict,'pass')
 }finally{f.cleanup()}
})

test('corrupt coverage metadata fails closed on reload and failed history survives unverified/partial reviews',async()=>{
 const f=fixture();try {
  const home=join(f.root,'coverage-store'),store=createAdvisorCoverage({home}),rows=[material()]
  recordCoverage(store,assessReviewEvidence(report(['F0'],'failed'),options(f.root,rows)))
  recordCoverage(store,assessReviewEvidence(report(['F0'],'unverified'),options(f.root,rows)),{runId:'r2',partial:true})
  const reloaded=createAdvisorCoverage({home}),current=await coverageFor(reloaded,coverageOptions(f.root))
  assert.equal(current.rows[0].knownFailures.length,1)
  assert.ok(reloaded.feedback({sessionId:'s',root:f.root,readEnabled:true,revisionMarker:'write:1'}).openIssues.some(c=>c.status==='failed'))
  const file=join(home,'po06-advisor-coverage.json'),persisted=JSON.parse(readFileSync(file,'utf8'))
  persisted.at(-1).report.evidenceAssessment.version=99;writeFileSync(file,JSON.stringify(persisted))
  const corrupt=await coverageFor(createAdvisorCoverage({home}),coverageOptions(f.root))
  assert.equal(corrupt.rows[0].verdict,'unverified');assert.equal(corrupt.rows[0].knownFailures.length,1)
  assert.ok(corrupt.limitations.some(x=>x.startsWith('claim-evidence-metadata-invalid')))
 }finally{f.cleanup()}
})

test('a path-only citation cannot select an earlier success while hiding a later failed or rejected read',()=>{
 for(const failed of [{tool:'read',args:{path:'a.js'},ok:false,resultAvailable:false,rejected:false},{tool:'read',args:{path:'a.js'},ok:false,resultAvailable:false,rejected:true}]){
  const got=assessReviewEvidence(report(['read:a.js']),options('C:/work',[],[read(),failed]))
  assert.equal(got.complete,false);assert.equal(got.report.checks[0].status,'unverified');assert.ok(got.evidenceGaps.some(x=>x.status==='ambiguous'))
 }
})

test('a shared supplemental file and identical focus cannot clear failure of a different explicit artifact',()=>{
 const f=fixture();try{const store=createAdvisorCoverage(),subject=(path,body)=>({path,kind:'file',status:'ready',sha256:hash(body)}),extra=material('extra.js','extra',{id:'F1',wholeFileComplete:true,selectedStartLine:1,selectedEndLine:1})
 const put=(path,body,status,runId)=>{const rows=[material(path,body,{id:'F0',wholeFileComplete:true,selectedStartLine:1,selectedEndLine:body.split('\n').length-1}),extra],out=assessReviewEvidence(report(['F0'],status),options(f.root,rows));assert.equal(out.complete,true);return store.record({sessionId:'s',requestId:'human:1',runId,scope:'code',focus:'same generic focus',revisionMarker:'write:1',materials:rows,subjects:[subject(path,body)],report:out.report,ok:true,partial:false})}
 put('a.js','alpha\nbeta\ngamma\n','failed','r1');put('b.js','bravo','satisfied','r2')
 let state=store.feedback({sessionId:'s',root:f.root,readEnabled:true,revisionMarker:'write:1'});assert.ok(state.openIssues.some(c=>c.status==='failed'&&c.paths.includes('a.js')))
 put('a.js','alpha\nbeta\ngamma\n','satisfied','r3');state=store.feedback({sessionId:'s',root:f.root,readEnabled:true,revisionMarker:'write:1'});assert.equal(state.openIssues.some(c=>c.status==='failed'),false)
 }finally{f.cleanup()}
})
