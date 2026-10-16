import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {EventEmitter} from 'node:events'
import {createInferenceTrace} from '../lib/inference-trace.js'
import {createControlHandler} from '../lib/control-api.js'
function client({locale='zh',fetch:fakeFetch=async()=>{throw new Error('Unexpected fetch in no-network UI test')}}={}){
 const registrations=[],slots=[],win={__ModuleLoader__:{load:r=>registrations.push(r)}}
 let stateIndex=0,stateOverrides={}
 const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'F',useState:v=>{const index=stateIndex++;return [Object.hasOwn(stateOverrides,index)?stateOverrides[index]:typeof v==='function'?v():v,()=>{}]},useRef:v=>({current:v}),useEffect:()=>{},useCallback:f=>f,useMemo:f=>f()}
 const req=name=>name==='react'?React:{}
 new Function('window','require','fetch',readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'))(win,req,fakeFetch)
 const mod=registrations[0].factory(req),dispose=mod.apply({slots:{register:(o,c)=>{slots.push({o,c});return()=>{}},inject:(_s,cb)=>cb()},locale})
 return {mod,slots,dispose,render:(fn,states={})=>{stateIndex=0;stateOverrides=states;return fn()}}
}
function nodes(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(nodes);return [node,...nodes(node.children)]}

// 「实验性功能」区块必须真的在弹出面板内部：插到面板外面会让它按整条宽度渲染、压住对话区
// （2026-10-06 真机截图事故）。这里用括号配对静态钉住位置，不依赖运行时状态。
test('experimental section lives inside the options popup',()=>{
 const text=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8')
 const popupOpen=text.lastIndexOf("h('div'",text.indexOf('S.optPop'))
 let depth=0,popupClose=-1
 for(let i=popupOpen;i<text.length;i++){const ch=text[i];if(ch==='(')depth++;else if(ch===')'){depth--;if(depth===0){popupClose=i;break}}}
 const divider=text.indexOf("'data-po06': 'experimental-divider'")
 const controls=text.indexOf('h(InferenceControls,{settings:eff',divider)
 assert.ok(divider>popupOpen&&divider<popupClose,'分界标题必须在弹出面板内部')
 assert.ok(controls>popupOpen&&controls<popupClose,'推理增强控件必须在弹出面板内部')
})

test('actual client mounts trace and the switch preserves per-session intent',()=>{
 const c=client();assert.equal(c.slots.filter(s=>s.o.name==='conversation.input.left').length,1)
 const bar=c.slots.find(s=>s.o.id==='prompt-optimizer').c({sessionId:'test-session',inputActions:{}})
 assert.ok(nodes(bar).some(n=>n.props['data-po06']==='options-btn'))
 // 关着「推理增强」时不该出现「推理过程」入口；开关打开才显示（见 english-mode 套件的源码断言）
 assert.ok(!nodes(bar).some(n=>n.type===c.mod.__debug.InferenceMonitor))
 const saved=[],tree=c.mod.__debug.InferenceControls({settings:{reasoningBoost:false,reasoningPace:'fast'},ready:true,save:p=>saved.push(p)})
 const button=nodes(tree).find(n=>n.props['data-po06']==='reasoning-boost')
 assert.ok(button);button.props.onClick();assert.deepEqual(saved,[{reasoningBoost:true}])
 assert.equal(nodes(tree).filter(n=>n.type==='button').length,1)
 assert.ok(!nodes(tree).some(n=>n.type==='select'))
 assert.ok(!nodes(tree).some(n=>['reasoning-mode','reasoning-pace','reasoningCandidates','reasoningRounds'].includes(n.props['data-po06'])))
 const on=c.mod.__debug.InferenceControls({settings:{reasoningBoost:true,reasoningMode:'loop',reasoningRounds:3,reasoningPace:'inherit'},ready:true,save:p=>saved.push(p)})
 nodes(on).find(n=>n.props['data-po06']==='reasoning-boost').props.onClick()
 assert.deepEqual(saved,[{reasoningBoost:true},{reasoningBoost:false}])
 assert.ok(c.mod.__debug.InferenceMonitor({sessionId:'test-session'}))
 c.dispose()
})
function req({url,method='GET',body,headers={}}){const r=new EventEmitter();Object.assign(r,{url,method,headers:{host:'127.0.0.1:19387',...headers}});setImmediate(()=>{if(body)r.emit('data',Buffer.from(JSON.stringify(body)));r.emit('end')});return r}
async function call(handler,options){let status,value;await handler(req(options),{writeHead:s=>status=s,end:text=>value=JSON.parse(text)});return {status,value}}
test('full traces survive reload and API refuses cross-session lookup and untrusted cancellation',async()=>{
 const home=mkdtempSync(join(tmpdir(),'inference-ui-'));try{
  const t=createInferenceTrace({home}),run=t.start('A',{},{}),id=t.startCall(run,{kind:'candidate',label:'one',input:{messages:['original task']},route:{}})
  const output='content'.repeat(10000);t.chunk(run,id,{type:'text-delta',index:0,text:output});t.finishCall(run,id);t.finish(run,{stage:'done',selectedCallId:id})
  const restored=createInferenceTrace({home});assert.equal(restored.get('A',run,id,{input:true}).textDelta,output)
  let cancellations=0
  const h=createControlHandler({home,inferenceList:s=>restored.list(s),inferenceGet:(s,r,c,o)=>restored.get(s,r,c,o),inferenceCancel:()=>{cancellations++;return {ok:true}}})
  writeFileSync(join(home,'po06.json'),JSON.stringify({reasoningBoost:false,bySession:{A:{reasoningBoost:true,reasoningMode:'hybrid',reasoningCandidates:3,reasoningRounds:2,reasoningPace:'balanced'}}}))
  const status=await call(h,{url:'/po06/api/status?session=A'})
  assert.equal(status.value.sessionEffective.reasoningBoost,true)
  assert.equal(status.value.sessionEffective.reasoningMode,'hybrid')
  assert.equal(status.value.sessionEffective.reasoningCandidates,3)
  assert.equal(status.value.sessionEffective.reasoningRounds,3)
  assert.equal(status.value.sessionEffective.reasoningPace,'fast')
  assert.equal((await call(h,{url:'/po06/api/inference-run?session=B&run='+run+'&call='+id})).status,404)
  const result=await call(h,{url:'/po06/api/inference-run?session=A&run='+run+'&call='+id+'&text=69999&input=1'})
  assert.equal(result.status,200);assert.equal(result.value.value.textDelta,output.slice(69999));assert.deepEqual(result.value.value.input,{messages:['original task']})
  assert.equal((await call(h,{method:'POST',url:'/po06/api/inference-cancel',body:{sessionId:'A',runId:run}})).status,403)
  assert.equal(cancellations,0)
 }finally{rmSync(home,{recursive:true,force:true})}
})


test('quick enhancement describes fixed concurrent directions, not three execution loops',()=>{
 const c=client();try{
 const tree=c.mod.__debug.InferenceControls({settings:{reasoningBoost:true,reasoningMode:'parallel',reasoningPace:'fast'},ready:true,save:()=>{}})
 const all=nodes(tree),visible=all.flatMap(n=>n.children.filter(x=>typeof x==='string')).join(' ')
 assert.equal(all.filter(n=>n.type==='button').length,1)
 assert.ok(!all.some(n=>n.type==='select'))
 assert.match(visible,/3\+3/)
 assert.match(visible,/并发生成三条|three concurrent/)
 assert.match(visible,/不做同一步串行精修|No same-step serial refinements/)
 assert.match(visible,/不表示实际执行了三轮修正|does not mean three correction loops ran/)
 assert.match(visible,/方向|Direction/)
 assert.match(visible,/原工作模型|original working model/)
 assert.match(visible,/不调用择优裁判|separate judge/)
 assert.match(visible,/不先写几份实现|multiple implementations/)
 }finally{c.dispose()}
})


test('trace shows usable direction counts, rejection reason and unresolved real evidence separately from acceptance',()=>{
 const c=client();try{
 const run={workflow:'directions-to-worker',protocolVersion:'4',iterationPlan:{effectiveCandidates:3,validDirections:1,rejectedDirections:2,duplicateDirections:0},directionMaxTokens:4096,directionObjective:'diagnose',decisions:[{kind:'direction-unavailable',reason:'direction-tool-protocol'},{kind:'direction-unavailable',reason:'direction-incomplete'}],evidenceState:{completionClaimAllowed:false,openIssues:[{id:'E17',criterion:'spacing varies',path:'artifact.html',version:'a'.repeat(64),status:'changed-pending',excerpt:'FAIL spacing varies <script>not executable</script>'}],limitations:[],omitted:{openIssues:2}}}
 const tree=c.mod.__debug.InferenceEvidenceDetails({run}),all=nodes(tree),text=all.flatMap(n=>n.children.filter(v=>typeof v==='string')).join(' ')
 assert.ok(all.some(n=>n.props['data-po06']==='inference-effective-directions'))
 assert.ok(all.some(n=>n.props['data-po06']==='inference-direction-rejections'))
 assert.ok(all.some(n=>n.props['data-po06']==='inference-evidence'))
 assert.match(text,/1/);assert.match(text,/2/);assert.match(text,/4096/);assert.match(text,/E17/);assert.match(text,/artifact.html/)
 assert.match(text,/伪工具协议|Simulated tool protocol/)
 assert.match(text,/不自动判断|not whole-product/)
 assert.ok(!all.some(n=>n.props.dangerouslySetInnerHTML),'observed tool text must remain text')
 assert.equal(run.evidenceState.completionClaimAllowed,false)
 }finally{c.dispose()}
})

const textOf=tree=>nodes(tree).flatMap(n=>n.children.filter(v=>typeof v==='string')).join(' ')

test('English and trace stay separate from boost and unavailable settings cannot enable it',()=>{
 const c=client(),saved=[]
 try{
  const english=c.mod.__debug.EnglishControls({settings:{englishMode:false,reasoningBoost:true},ready:true,save:p=>saved.push(p)})
  nodes(english).find(n=>n.type===c.mod.__debug.Segmented).props.onPick('on')
  assert.deepEqual(saved,[{englishMode:true}])
  const trace=c.render(()=>c.mod.__debug.InferenceMonitor({sessionId:'A'}))
  nodes(trace).find(n=>n.props['data-po06']==='inference-open').props.onClick()
  assert.deepEqual(saved,[{englishMode:true}],'opening a trace must not save boost or profile fields')
  const unloaded=c.mod.__debug.InferenceControls({settings:{},ready:true,save:p=>saved.push(p)})
  assert.equal(nodes(unloaded).find(n=>n.props['data-po06']==='reasoning-boost').props.disabled,true)
  const enabled=c.mod.__debug.InferenceControls({settings:{reasoningBoost:true},ready:false,save:p=>saved.push(p)})
  const off=nodes(enabled).find(n=>n.props['data-po06']==='reasoning-boost')
  assert.equal(off.props.disabled,false,'turning off remains available when host is unavailable')
  off.props.onClick();assert.deepEqual(saved.at(-1),{reasoningBoost:false})
 }finally{c.dispose()}
})

test('mounted session enhancement writes no global hidden changes and trace follows only its on/off flag',async()=>{
 const posts=[],c=client({fetch:async(url,options)=>{if(options.method==='POST')posts.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})}}})
 try{
  const settings={reasoningBoost:false,englishMode:false,permission:'review',bySession:{A:{tier:'off',englishMode:true},B:{tier:'heavy',reasoningBoost:false}}}
  const status={settings,sessionEffective:{...settings,assist:'off',detail:'standard',budget:'standard',reasoningBoost:false,englishMode:true},inference:{ready:true},english:{ready:true}}
  const render=boost=>c.render(()=>c.slots.find(s=>s.o.id==='prompt-optimizer').c({sessionId:'A',inputActions:{}}),{0:{loading:false,data:{...status,sessionEffective:{...status.sessionEffective,reasoningBoost:boost}},error:null},2:true})
  const offBar=render(false)
  assert.ok(!nodes(offBar).some(n=>n.type===c.mod.__debug.InferenceMonitor))
  const control=nodes(offBar).find(n=>n.type===c.mod.__debug.InferenceControls)
  assert.ok(control,'off source tier must not remove independent boost controls')
  const button=nodes(c.mod.__debug.InferenceControls(control.props)).find(n=>n.props['data-po06']==='reasoning-boost')
  await button.props.onClick()
  assert.deepEqual(posts,[{url:'/po06/api/settings',body:{bySession:{A:{tier:'off',englishMode:true,reasoningBoost:true},B:{tier:'heavy',reasoningBoost:false}}}}])
  assert.deepEqual(settings.bySession.A,{tier:'off',englishMode:true},'client source status remains untouched')
  const onBar=render(true)
  assert.equal(nodes(onBar).filter(n=>n.type===c.mod.__debug.InferenceMonitor).length,1)
 }finally{c.dispose()}
})

test('current actual results, active issues and historical invocation incidents are separate text-safe lists',()=>{
 const c=client()
 try{
  const recent={id:'NEW-PASS',outcome:'pass',excerpt:'PASS newest actual check'}
  const active={id:'CURRENT-FAIL',criterion:'current spacing',status:'open',excerpt:'FAIL current spacing <img src=x onerror=alert(1)>'}
  const retained={id:'OLD-CALL',kind:'invocation',status:'open',excerpt:'earlier invocation rejected'}
  const state={mode:'explore',recentEvidence:[recent],activeIssues:[active],retainedIncidents:[retained],openIssues:[active,retained,{id:'RAW-AUDIT-ONLY'}],focusPolicy:{activeCount:1,retainedInvocationCount:1,token:'private-focus-token'},completionClaimAllowed:false}
  const before=structuredClone(state),tree=c.mod.__debug.InferenceEvidenceDetails({run:{protocolVersion:'5',evidenceState:state}}),all=nodes(tree)
  const section=id=>all.find(n=>n.props['data-po06']===id)
  assert.match(textOf(section('inference-recent-evidence')),/NEW-PASS/)
  assert.doesNotMatch(textOf(section('inference-recent-evidence')),/CURRENT-FAIL|OLD-CALL/)
  assert.match(textOf(section('inference-active-issues')),/CURRENT-FAIL/)
  assert.doesNotMatch(textOf(section('inference-active-issues')),/OLD-CALL|NEW-PASS/)
  assert.match(textOf(section('inference-retained-incidents')),/OLD-CALL/)
  assert.match(textOf(section('inference-retained-incidents')),/不代表当前仍失败，也不表示已经修复|neither a current-failure claim/)
  assert.match(textOf(section('inference-completion-boundary')),/不授权宣称完成|does not authorize/)
  assert.match(textOf(tree),/探索|Explore/)
  assert.doesNotMatch(textOf(tree),/RAW-AUDIT-ONLY|private-focus-token/)
  assert.ok(!all.some(n=>n.props.dangerouslySetInnerHTML||n.type==='img'||n.type==='script'))
  assert.deepEqual(state,before)
 }finally{c.dispose()}
})

test('evidence details tolerate numeric counts and missing projected fields',()=>{
 const c=client()
 try{
  const counted=c.mod.__debug.InferenceEvidenceDetails({run:{evidenceState:{activeIssues:2,retainedIncidents:7,mode:'diagnose',completionClaimAllowed:false}}})
  assert.match(textOf(nodes(counted).find(n=>n.props['data-po06']==='inference-active-issues')),/2/)
  assert.match(textOf(nodes(counted).find(n=>n.props['data-po06']==='inference-retained-incidents')),/7/)
  assert.match(textOf(counted),/诊断|Diagnose/)
  assert.doesNotThrow(()=>c.mod.__debug.InferenceEvidenceDetails({run:{evidenceState:{}}}))
  assert.doesNotThrow(()=>c.mod.__debug.InferenceEvidenceDetails({}))
 }finally{c.dispose()}
})

test('recorded old mode pace effort and rounds are never relabeled as the current fast profile',()=>{
 const c=client()
 try{
  const legacy={protocolVersion:'3',workflow:'reply-loop',settings:{reasoningMode:'loop',reasoningPace:'inherit'},effortPlan:{candidate:'max',review:'high'},iterationPlan:{effectiveCandidates:1,effectiveRounds:3,maxCalls:10},calls:[{}]}
  const before=structuredClone(legacy),text=textOf(c.mod.__debug.InferenceRecordedPlan({run:legacy}))
  for(const value of ['loop','inherit','max','high','3'])assert.ok(text.includes(value),value+' must remain recorded')
  assert.doesNotMatch(text,/fast|3\+3/i)
  assert.deepEqual(legacy,before)
  const missing=textOf(c.mod.__debug.InferenceRecordedPlan({run:{protocolVersion:'1'}}))
  assert.match(missing,/未记录|Not recorded/);assert.doesNotMatch(missing,/fast|hybrid|inherit/)
  const unknown=textOf(c.mod.__debug.InferenceRecordedPlan({run:{mode:'serial',iterationPlan:{effectiveCandidates:1,effectiveRounds:5,maxCalls:9}}}))
  assert.match(unknown,/serial/);assert.match(unknown,/5/);assert.doesNotMatch(unknown,/fast/)
  const current=textOf(c.mod.__debug.InferenceRecordedPlan({run:{protocolVersion:'5',workflow:'directions-to-worker',settings:{reasoningMode:'hybrid',reasoningPace:'fast'},effortPlan:{direction:'low',working:'max'},iterationPlan:{profile:'fast-3x3',effectiveCandidates:3,effectiveRounds:0,maxExtraCalls:3,extraCallsUsed:3,workingCallsUsed:1}}}))
  assert.match(current,/3\+3/);assert.match(current,/无同一步串行精修|no same-step serial refinements/);assert.doesNotMatch(current,/最多 3 轮|up to 3.*rounds/)
 }finally{c.dispose()}
})

test('trace component reads old generations without new direction counters or evidence',()=>{
 const c=client();try{
 const tree=c.mod.__debug.InferenceEvidenceDetails({run:{workflow:'directions-to-worker',directionCallIds:['old-a','old-b'],decisions:[]}})
 const text=nodes(tree).flatMap(n=>n.children.filter(v=>typeof v==='string')).join(' ')
 assert.match(text,/2/);assert.ok(!nodes(tree).some(n=>n.props['data-po06']==='inference-evidence'))
 }finally{c.dispose()}
})
