// GitHub open issues #31 / #32 的逐条回归。两个 issue 的**根因**都在这里钉死；
// 刻意保留的边界也一起钉（不许为了"看起来修好了"把已有防线放松）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {extractJson,extractBalancedObject} from '../lib/interpreter.js'
import {createAdvisor} from '../lib/advisor.js'

const COMPLETE='{"intent":{"text":"Original request","relation":"continue"},"clarify":["one question"]}'

test('#31 截断/散文仍然失败；**结构不配平**按新决定做可记账的配平修复',()=>{
  // 2026-10-21 用户决定：结构性的括号错位/缺失应当修，而不是整轮作废；但**绝不编内容**。
  // 一次真机失败就是把 `"ask":[…]` 收尾写成 `}`，整包被判废、白烧一轮调用。
  for(const [label,raw] of [
    ['truncated mid-object','{"ops":[{"op":"add_item"'],
    ['no json at all','这一轮没有 JSON，只有一句话。'],
    ['array top-level','["not","an","object"]'],
  ]){
    const r=extractJson(raw)
    assert.equal(r.ok,false,label+' 仍然失败——修结构不等于猜内容')
  }
  // 缺一个收尾括号：允许补上，但必须带 recovered 标记，供上层记账。
  const closed=extractJson('{"intent":{"text":"x"}')
  assert.equal(closed.ok,true,'结构缺失可以补齐')
  assert.equal(closed.recovered,'bracket-repair')
  assert.equal(closed.value.intent.text,'x','补齐不改变内容')
  // 字符串内部的括号不吃配平（否则 {"a":"}"} 会被截错）
  const inside=extractBalancedObject('{"a":"} not the end","b":1}')
  assert.equal(inside.ok,true);assert.equal(inside.value.a,'} not the end')
})

test('#32 读不到的材料必须能当证据引用：报告不再因为"说了实话"被整份判为无效引用',async()=>{
  const root=mkdtempSync(join(tmpdir(),'po06-issue32-'))
  try{
    writeFileSync(join(root,'present.md'),'ACTUAL CONTENT')
    const events=[{type:'user/message',seq:1,data:{source:{kind:'user'},content:[{type:'text',text:'复核这个文件'}]}}]
    const exec={callId:'c',agent:{session:{id:'issue32',snapshotEvents:()=>events}}}
    // 顾问给出的正是"我读不到它"这份老实报告：findings 引 F0，check 记 unverified。
    const honest=JSON.stringify({verdict:'unverified',
      summary:'材料 F0 读不到：status=unavailable，reason=read-tools-disabled-or-no-cwd。',
      findings:[{text:'F0 未附任何内容，因此本次没有任何可观察的结论。',evidenceRefs:['F0']}],
      checks:[{criterion:'材料是否可读',status:'unverified',evidenceRefs:['F0']}],
      nextStep:'开启只读工具后重试',stopCondition:'读不到就不再重复咨询'})
    const invoke=createAdvisor({resolveRuntime:async()=>({ok:true,cwd:root,readTools:false,cfg:{provider:'p',model:'m'},llm:{stream:()=>(async function*(){yield{type:'text-delta',text:honest}})()}})})
    const out=await invoke({mode:'review_result',scope:'general',focus:'材料可读性',question:'这个文件能读到吗',files:[{path:'present.md',purpose:'待复核'}]},exec)
    assert.equal(out.ok,true,'报告本身没有问题，不许因为引用了"读不到"的材料就整份作废：'+String(out.reason))
    assert.equal(out.materials[0].id,'F0')
    assert.equal(out.materials[0].status,'unavailable')
    assert.equal(out.materials[0].sent,false)
    assert.deepEqual(out.report.findings[0].evidenceRefs,['F0'],'findings 里的 F0 要原样保留')
    assert.equal(out.report.checks[0].status,'unverified')
    assert.equal(out.reviewPassed,false,'读不到材料绝不可能通过复核')
    assert.ok(out.evidenceGaps.length>0,'缺口要在结果里可见（按验收项记账，不按材料 id）')
    assert.ok(out.reviewState.limitations.includes('material-evidence-unavailable'),'限制要写明是"材料证据拿不到"')

    // 边界（**刻意保留**，不是本次要修的）：声称 satisfied 却只有"读不到"的材料 ⇒ 仍然整份拒绝。
    // 理由：satisfied 是"我核实过并通过了"，而读不到的材料不可能支撑任何通过。
    const overclaim=JSON.stringify({verdict:'unverified',summary:'s',
      findings:[{text:'F0 读不到',evidenceRefs:['F0']}],
      checks:[{criterion:'材料是否可读',status:'satisfied',evidenceRefs:['F0']}],nextStep:'n',stopCondition:'x'})
    const second=createAdvisor({resolveRuntime:async()=>({ok:true,cwd:root,readTools:false,cfg:{provider:'p',model:'m'},llm:{stream:()=>(async function*(){yield{type:'text-delta',text:overclaim}})()}})})
    const refused=await second({mode:'review_result',scope:'general',focus:'材料可读性',question:'这个文件能读到吗',files:[{path:'present.md',purpose:'待复核'}]},exec)
    // 新契约：答复照常返回，但那句没有结果证据的 satisfied 不许生效。
    assert.equal(refused.ok,true)
    assert.equal(refused.reviewPassed,false,'没有结果证据的 satisfied 仍然不许过——这条防线不许松')
    assert.ok((refused.report.evidenceIssues??[]).some(i=>i.reason==='invalid-check'))
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('#32 status 必须报告真实的只读状态，不能再写死 readEnabled:false',async()=>{
  const source=(await import('node:fs')).readFileSync(new URL('../lib/index.js',import.meta.url),'utf8')
  assert.equal(/advisorStages\.status\(\{sessionId:String\(sid\),readEnabled:false\}\)/.test(source),false,'index.js 不许再写死 readEnabled:false')
  assert.ok(/const readEnabled=pol\?\.readTools===true/.test(source),'要按本会话真实策略取值')
  assert.ok(/return \{ok:true,protocolVersion:2,enabled:pol\?\.injectPacket===true,readEnabled,stage/.test(source),'状态返回值里要带上真实取值，面板才有东西可显示')
  assert.ok(/file-reread-enabled/.test(source),'verification 标签要跟着真实取值变，而不是写死')
})
