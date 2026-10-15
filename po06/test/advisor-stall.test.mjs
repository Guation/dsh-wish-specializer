import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createAdvisor,ADVISOR_STALL_MS,effectiveAdvisorStallMs,resolveAdvisorStallMs} from '../lib/advisor.js'
import {createAdvisorProgress} from '../lib/advisor-progress.js'

const here=dirname(fileURLToPath(import.meta.url))
const events=[{type:'user/message',seq:1,data:{source:{kind:'user'},content:[{type:'text',text:'检查这个对象'}]}}]
const exec={callId:'c1',agent:{session:{id:'stall-s',snapshotEvents:()=>events}}}
const REPORT=JSON.stringify({verdict:'need_user',summary:'已核对对象',findings:[{text:'观察到的事实',evidenceRefs:[]}],checks:[],nextStep:'下一步',stopCondition:'停止重复'})
// readTools:false ⇒ 走裸流那条路，正好用来精确观测"有没有产出"。
const invokeWith=(stream,{stallMs,timeoutMs}={})=>createAdvisor({
  ...(stallMs===undefined?{}:{stallMs}), ...(timeoutMs===undefined?{}:{timeoutMs}),
  resolveRuntime:async()=>({ok:true,cwd:process.cwd(),readTools:false,cfg:{provider:'p',model:'m'},llm:{stream}}),
})

test('空闲阈值解析：默认、显式、非法、0 关闭，以及"永远晚于总熔断就关掉"',()=>{
  assert.equal(ADVISOR_STALL_MS,90000)
  assert.equal(resolveAdvisorStallMs({}),90000)
  assert.equal(resolveAdvisorStallMs({},null),90000)
  assert.equal(resolveAdvisorStallMs({DSH_PO06_ADVISOR_STALL_MS:'30000'}),30000)
  assert.equal(resolveAdvisorStallMs({DSH_PO06_ADVISOR_STALL_MS:'0'}),0,'0 = 显式关闭本守卫')
  assert.equal(resolveAdvisorStallMs({DSH_PO06_ADVISOR_STALL_MS:'abc'}),90000,'非法值回落默认')
  assert.equal(resolveAdvisorStallMs({DSH_PO06_ADVISOR_STALL_MS:'-5'}),90000,'负值回落默认')
  assert.equal(resolveAdvisorStallMs({DSH_PO06_ADVISOR_STALL_MS:'  '}),90000,'空串回落默认')
  // 折算：不早于总熔断就永远轮不到，明确关掉而不是留一个看起来配了的常量。
  assert.equal(resolveAdvisorStallMs({},60000),0,'90s 默认晚于 60s 总熔断 ⇒ 关掉')
  assert.equal(resolveAdvisorStallMs({DSH_PO06_ADVISOR_STALL_MS:'20000'},60000),20000)
  assert.equal(resolveAdvisorStallMs({DSH_PO06_ADVISOR_STALL_MS:'60000'},60000),0,'等于总熔断也关掉（谁先谁后不确定）')
  assert.equal(effectiveAdvisorStallMs(0,60000),0)
  assert.equal(effectiveAdvisorStallMs(5000,null),5000)
})

test('完全没有产出：在空闲阈值判死，并且真的把在途模型流 abort 掉（不是只回一个原因）',async()=>{
  let settled=false,aborted=false,signal=null
  const invoke=invokeWith(o=>{signal=o.signal;return (async function*(){
    await new Promise(resolve=>{const s=o.signal;if(!s){setTimeout(resolve,2000);return}if(s.aborted)return resolve();s.addEventListener('abort',()=>{aborted=true;resolve()},{once:true})})
    settled=true
  })()},{stallMs:60})
  const started=Date.now(),out=await invoke({mode:'diagnose_failure',question:'核对这个对象'},exec)
  const elapsed=Date.now()-started
  assert.equal(settled,true,'判死必须真的收掉模型流，否则中途还在烧额度')
  assert.equal(aborted,true,'abort 必须落到模型调用上')
  assert.ok(signal,'要用真实 signal')
  assert.equal(out.reason,'advisor-stall-timeout')
  assert.ok(elapsed<1500,'空闲阈值要真的提前结束，而不是等满总熔断（用时 '+elapsed+'ms）')
})

test('持续有产出绝不判死（防误报的防线）',async()=>{
  let beats=0
  const invoke=invokeWith(()=>(async function*(){
    yield{type:'text-delta',text:REPORT}
    for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,20));beats++;yield{type:'reasoning-delta',text:'·'}}
    yield{type:'finish',reason:{kind:'stop'}}
  })(),{stallMs:60})
  const out=await invoke({mode:'diagnose_failure',question:'核对这个对象'},exec)
  assert.ok(beats>=6,'检查夹具真的产出了多个增量：'+beats)
  assert.notEqual(out.reason,'advisor-stall-timeout')
  assert.notEqual(out.cut,'advisor-stall-timeout')
  assert.notEqual(out.partial,true,'持续有产出时不该被判成截断')
})

test('已经产出半截内容后才挂住：标 partial 交回，不把产出丢掉',async()=>{
  const invoke=invokeWith(o=>(async function*(){
    yield{type:'text-delta',text:REPORT}
    await new Promise(resolve=>{const s=o.signal;if(!s)return setTimeout(resolve,2000);if(s.aborted)return resolve();s.addEventListener('abort',resolve,{once:true})})
  })(),{stallMs:60,timeoutMs:5000})
  const out=await invoke({mode:'review_result',scope:'general',focus:'对象',question:'核对这个对象'},exec)
  assert.equal(out.cut,'advisor-stall-timeout')
  assert.equal(out.partial,true)
  assert.ok(out.report||out.raw,'已产出的内容必须交回')
})

test('stallMs=0 关闭守卫后行为回到总熔断，不多不少',async()=>{
  const invoke=invokeWith(o=>(async function*(){
    await new Promise(resolve=>{const s=o.signal;if(!s)return setTimeout(resolve,2000);if(s.aborted)return resolve();s.addEventListener('abort',resolve,{once:true})})
  })(),{stallMs:0,timeoutMs:80})
  const out=await invoke({mode:'diagnose_failure',question:'核对这个对象'},exec)
  assert.equal(out.reason,'advisor-timeout','关闭空闲守卫后只能是总熔断')
})

test('空闲判死归入既有 timeout 终态，界面卡片才会收尾（不新造 stage 名）',()=>{
  const progress=createAdvisorProgress()
  const runId=progress.start({sessionId:'s',callId:'x',mode:'diagnose_failure',question:'q',scope:'general'})
  progress.finish(runId,{ok:false,reason:'advisor-stall-timeout',cut:'advisor-stall-timeout'})
  assert.equal(progress.get('s',{runId}).stage,'timeout')
  // 另外两态不能被这次改动带偏。
  const run2=progress.start({sessionId:'s',callId:'y',mode:'diagnose_failure',question:'q',scope:'general'})
  progress.finish(run2,{ok:false,reason:'advisor-cancelled',cut:'advisor-cancelled'})
  assert.equal(progress.get('s',{runId:run2}).stage,'cancelled')
  const run3=progress.start({sessionId:'s',callId:'z',mode:'diagnose_failure',question:'q',scope:'general'})
  progress.finish(run3,{ok:false,reason:'provider-500'})
  assert.equal(progress.get('s',{runId:run3}).stage,'failed')
})

test('消费方守卫：界面文案与宿主接线都要真的存在（只加常量 = 守卫不存在）',()=>{
  const client=readFileSync(join(here,'..','lib','client.js'),'utf8')
  assert.ok(client.includes("'advisor-stall-timeout': L("),'客户端要有人话文案，否则把内部字符串甩给用户')
  assert.ok(/advisor-stall-timeout[^\n]*'[^']*[\u4e00-\u9fff]/.test(client),'中文文案要在')
  const index=readFileSync(join(here,'..','lib','index.js'),'utf8')
  assert.ok(index.includes("resolveAdvisorStallMs"),'index.js 要导入解析函数')
  assert.ok(/stallMs:\s*resolveAdvisorStallMs\(process\.env/.test(index),'index.js 必须把 stallMs 真的接进 createAdvisor')
  assert.ok(/stallMs:\s*resolveAdvisorStallMs\(process\.env,\s*resolveAdvisorTimeoutMs\(process\.env\)\)/.test(index),'折算要带上本次总限时')
})
