import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAdvisor} from '../lib/advisor.js'
import {createAdvisorCoverage} from '../lib/advisor-coverage.js'
import {scopePolicy,scopedSnapshot,validateScope,revisionMarker,DELIVERY_ITEM_SCOPES} from '../lib/advisor-scopes.js'
import {ADVISOR_PARAMETERS} from '../lib/advisor.js'
const root=mkdtempSync(join(tmpdir(),'advisor-scopes-'))
writeFileSync(join(root,'code.js'),'REAL CODE')
writeFileSync(join(root,'view.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=','base64'))
const events=[{type:'user/message',seq:1,data:{source:{kind:'user'},content:[{type:'text',text:'制作可预览的模型，只读本次产物'}]}},
 {type:'tool/result',seq:2,data:{message:{toolCallId:'t1',content:[{type:'text',text:'UNRELATED ALL TESTS PASSED'}]}}}]
const exec={callId:'invoke',agent:{session:{id:'scoped-session',snapshotEvents:()=>events}}}
const desc=path=>({path,purpose:'本次检查'})
const raw=ref=>JSON.stringify({verdict:'pass',summary:'本次对象满足',findings:[],checks:[{criterion:'当前对象',status:'satisfied',evidenceRefs:[ref]}],nextStep:'继续其它专项',stopCondition:'对象变化重审'})
test('geometry独立首轮不见源码/历史，源码支持可用而非永久排除；code只走相关源码',async()=>{
 let visual,code
 const store=createAdvisorCoverage()
 const invoke=createAdvisor({coverage:store,resolveRuntime:async()=>({ok:true,cwd:root,readTools:true,imageSupport:true,cfg:{provider:'p',model:'m'},
 attachments:{saveImage:async()=>({attachmentId:'fake',mediaType:'image/png',bytes:60,width:1,height:1})},
 llm:{stream:opts=>{visual=opts;return(async function*(){yield{type:'text-delta',text:raw('I0')}})()}}}),
 runLoop:async opts=>{code=opts;return{text:raw('F0'),trace:[]}}})
 const materials={files:[desc('code.js')],images:[desc('view.png')]}
 const v=await invoke({mode:'review_result',scope:'geometry',focus:'轮系朝向',question:'只检查装配',...materials},exec)
 assert.equal(v.ok,true);assert.equal(v.reviewScope,'geometry');assert.equal(code,undefined)
 const p=JSON.parse(visual.messages[0].content[0].text)
 assert.equal(p.snapshot.records.length,0);assert.equal(p.artifacts.some(x=>x.kind==='file'),false)
 assert.ok(!visual.messages[0].content[0].text.includes('REAL CODE'))
 assert.ok(!visual.messages[0].content[0].text.includes('ALL TESTS PASSED'))
 assert.equal(visual.messages[0].content.filter(x=>x.type==='image').length,1)
 assert.ok(visual.system.includes('朝向')&&visual.system.includes('重叠与穿插'))
 assert.equal(v.materials.find(x=>x.path==='code.js').status,'ready')
 const c=await invoke({mode:'review_result',scope:'code',focus:'轮系朝向',question:'核对源码',...materials},exec)
 assert.equal(c.ok,true);assert.ok(code.system.includes('代码正确性'))
 assert.ok(code.messages[0].content[0].text.includes('REAL CODE'))
 assert.equal(code.messages[0].content.filter(x=>x.type==='image').length,0)
 assert.equal(c.materials.find(x=>x.path==='view.png').status,'excluded')
 assert.equal(store.history({sessionId:'scoped-session',requestId:v.requestId}).length,2)
})
test('无图片的geometry不能靠历史全过判通过',async()=>{
 let input
 const invoke=createAdvisor({resolveRuntime:async()=>({ok:true,cwd:root,readTools:true,cfg:{provider:'p',model:'m'},llm:{stream:opts=>{input=opts;return(async function*(){yield{type:'text-delta',text:raw('E2')}})()}}})})
 const out=await invoke({mode:'review_result',scope:'geometry',focus:'轮系',question:'检查'},exec)
 assert.equal(out.ok,false);assert.equal(out.reason,'visual-evidence-required')
 assert.equal(input,undefined)
})
test('明确focus与delivery精确清单校验，源码write变更不被截图写入混淆',()=>{
 assert.equal(validateScope({scope:'geometry'}),'review-focus-required')
 // GitHub #33A：非 delivery 下这两个参数是纯 no-op（消费方全在 delivery 分支内），
 // 原先按硬错误拒掉整次调用 ⇒ 真机某会话 21 连败 0 成功。现在一律放行，也**不改写**调用方 args。
 assert.equal(validateScope({scope:'code',focus:'a',requiredReviews:[{scope:'code',focus:'a'}]}),null)
 assert.equal(validateScope({scope:'geometry',focus:'a',requiredScopes:['general'],requiredReviews:[{scope:'delivery',focus:'x'}]}),null)
 assert.equal(validateScope({scope:'custom',focus:'a',requiredScopes:'not-an-array'}),null)
 assert.equal(validateScope({scope:'delivery',focus:'交付',requiredReviews:[{scope:'geometry',focus:'轮系'}]}),null)
 assert.equal(validateScope({scope:'delivery',focus:'交付',requiredScopes:['geometry','code']}),null)
 const e=[{type:'tool/ptc-dispatch-start',seq:1,data:{subCallId:'x',name:'write',arguments:{file_path:'code.js'}}},{type:'tool/ptc-dispatch',seq:2,data:{subCallId:'x',isError:false}}]
 assert.equal(revisionMarker(e),'write:2')
 e.push({type:'tool/ptc-dispatch-start',seq:3,data:{subCallId:'i',name:'write',arguments:{file_path:'view.png'}}},{type:'tool/ptc-dispatch',seq:4,data:{subCallId:'i'}})
 assert.equal(revisionMarker(e),'write:2')
})
test('delivery精确核对已复核对象；材料变更与缺scope清单不能沿用通过',async()=>{
 const store=createAdvisorCoverage();let state,turn=0
 const invoke=createAdvisor({coverage:store,resolveRuntime:async()=>({ok:true,cwd:root,readTools:true,cfg:{provider:'p',model:'m'},
 llm:{stream:opts=>{state=JSON.parse(opts.messages[0].content[0].text);return(async function*(){yield{type:'text-delta',text:raw(state.coverage.rows[0].id)}})()}}}),
 runLoop:async()=>({text:raw('F0'),trace:[]})})
 await invoke({mode:'review_result',scope:'code',focus:'表单提交',question:'检查提交',files:[desc('code.js')]},exec)
 const final=await invoke({mode:'review_result',scope:'delivery',focus:'交付前覆盖',question:'核对覆盖',requiredReviews:[{scope:'code',focus:'表单提交'}]},exec)
 assert.equal(final.ok,true);assert.equal(final.report.verdict,'pass')
 assert.equal(state.snapshot.records.length,0);assert.equal(state.coverage.rows[0].focus,'表单提交')
 assert.equal(final.reviewScope,'delivery');assert.equal(final.coverage.rows.length,1)
 writeFileSync(join(root,'code.js'),'CHANGED CODE')
 const changed=await invoke({mode:'review_result',scope:'delivery',focus:'交付前覆盖',question:'核对覆盖',requiredReviews:[{scope:'code',focus:'表单提交'}]},exec)
 assert.ok(changed.ok===false||changed.report.verdict!=='pass')
 assert.equal(changed.coverage.rows[0].status,'changed')
 assert.equal(changed.coverage.missingReviews.length,1)
})
test('清理专项夹具',()=>rmSync(root,{recursive:true,force:true}))
test('delivery 内的非法清单仍被拒，且理由带当前值、允许值与正确用法（GitHub #33A）',()=>{
  const badScope=validateScope({scope:'delivery',focus:'交付',requiredScopes:['general']})
  assert.equal(badScope.reason,'invalid-required-scopes')
  assert.ok(badScope.detail.includes('"general"'),'拒绝理由要回显当前值')
  assert.ok(badScope.detail.includes('delivery'),'拒绝理由要写清正确用法')
  assert.ok(badScope.detail.includes('DELIVERY_ITEM_SCOPES')===false,'不要把内部标识符当用户可见取值说明')
  assert.ok(badScope.detail.includes('geometry'),'要给出允许取值')
  const tooMany=validateScope({scope:'delivery',focus:'交付',requiredScopes:Array.from({length:9},()=>'code')})
  assert.equal(tooMany.reason,'invalid-required-scopes')
  const badReviews=validateScope({scope:'delivery',focus:'交付',requiredReviews:[{scope:'delivery',focus:'x'}]})
  assert.equal(badReviews.reason,'invalid-required-reviews')
  assert.ok(badReviews.detail.includes('requiredReviews'))
  assert.equal(validateScope({scope:'delivery',focus:'交付',requiredReviews:Array.from({length:13},(_,i)=>({scope:'code',focus:'f'+i}))}).reason,'invalid-required-reviews')
  assert.equal(validateScope({scope:'delivery',focus:'交付',requiredReviews:[{scope:'code',focus:'   '}]}).reason,'invalid-required-reviews')
})

test('冻结的 args 在非 delivery 下必须放行且不被改写（宿主可能传 Object.freeze）',()=>{
  const frozen=Object.freeze({scope:'code',focus:'对象',requiredScopes:Object.freeze(['geometry']),requiredReviews:Object.freeze([Object.freeze({scope:'code',focus:'a'})])})
  assert.equal(validateScope(frozen),null)
  assert.deepEqual(frozen.requiredScopes,['geometry'])
  assert.equal(frozen.requiredReviews.length,1)
  assert.equal(frozen.requiredScopes.length,1)
})

test('schema 的 enum 与校验器同源：两个 delivery 参数都不许 general/delivery',()=>{
  const props=ADVISOR_PARAMETERS.properties
  assert.deepEqual(props.requiredScopes.items.enum,DELIVERY_ITEM_SCOPES)
  assert.deepEqual(props.requiredReviews.items.properties.scope.enum,DELIVERY_ITEM_SCOPES)
  assert.equal(props.requiredScopes.items.enum.includes('general'),false)
  assert.equal(props.requiredScopes.items.enum.includes('delivery'),false)
  assert.ok(props.requiredScopes.description.includes('no-op'),'描述要说明非 delivery 下是 no-op')
})

test('真实入口：非 delivery 带 requiredScopes/requiredReviews 不再整次失败，delivery 内仍被拒',async()=>{
  // 自己一套夹具：文件级夹具目录会被后面的"清理专项夹具"删掉，不能复用。
  const own=mkdtempSync(join(tmpdir(),'advisor-scopes-33a-'));writeFileSync(join(own,'code.js'),'REAL CODE')
  try{
  let looped=0
  // llm 属于 resolveRuntime 的返回值；runLoop 属于 createAdvisor 的选项 —— 两者别放错层。
  const invoke=createAdvisor({
   resolveRuntime:async()=>({ok:true,cwd:own,readTools:true,cfg:{provider:'p',model:'m'},
     llm:{stream:()=>{throw new Error('scope=code 应走只读工具循环，不该走裸流')}}}),
   runLoop:async()=>{looped++;return{text:raw('F0'),trace:[]}}})
  const ok=await invoke({mode:'review_result',scope:'code',focus:'表单提交',question:'检查',files:[desc('code.js')],
   requiredScopes:['geometry'],requiredReviews:[{scope:'geometry',focus:'轮系'}]},exec)
  assert.equal(ok.ok,true,'非 delivery 下这两个参数是 no-op，不得拒整次调用（实际 reason='+String(ok.reason)+'）')
  assert.equal(looped,1,'真实入口必须真的跑到模型路径，而不是在参数校验处就被拒')
  const rejected=await invoke({mode:'review_result',scope:'delivery',focus:'交付前覆盖',question:'核对',
   requiredScopes:['general']},exec)
  assert.equal(rejected.ok,false);assert.equal(rejected.reason,'invalid-required-scopes')
  assert.ok(rejected.detail&&rejected.detail.includes('requiredScopes'))
  assert.equal(looped,1,'被拒的 delivery 调用不得产生模型调用（拒绝要在花钱之前）')
  }finally{rmSync(own,{recursive:true,force:true})}
})
