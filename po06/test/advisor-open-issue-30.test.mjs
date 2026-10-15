import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createAdvisor,registerAdvisorTool} from '../lib/advisor.js'
import {createAdvisorProgress} from '../lib/advisor-progress.js'
import {registerAdvisorStageTool} from '../lib/advisor-stage-tool.js'
import {createAdvisorStages} from '../lib/advisor-stages.js'
import {toolRead} from '../lib/read-tools.js'

// GitHub issue #30 的两条报告，全部通过真实入口（createAdvisorStages / createAdvisor / registerAdvisorTool）复现：
//  (a) 顾问分段读同一个文件时材料行数按**文件版本**归并，而不是按区间；
//  (b) 中断的调用把 partialReasoning / activities / raw 交回结果与卡片，且「保留部分内容」标题由真实产出决定。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceLines = count => Array.from({length:count},(_,i)=>'const k'+String(i+1).padStart(3,'0')+' = '+i)
const readRow = (root,startLine,endLine) => ({tool:'read',args:{path:'app.js',startLine,endLine},ok:true,rejected:false,resultAvailable:true,
  resultLines:endLine-startLine+1,evidence:toolRead(root,{path:'app.js',startLine,endLine}).evidence})
const reviewReport = (checkId,criterion) => JSON.stringify({verdict:'pass',summary:'segmented source read',findings:[],
  checks:[{checkId,criterion,status:'satisfied',evidenceRefs:['read:app.js']}],nextStep:'continue',stopCondition:'stop'})

// ——— (a) 阶段台账 fixture：真实阶段工具 + 真实只读证据 ———
const stageFixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'po06-issue30-stage-'))
 writeFileSync(join(root,'app.js'),sourceLines(120).join('\n'))
 const stages=createAdvisorStages({home:root})
 const session={id:'s',header:{cwd:root},snapshotEvents:()=>[{seq:1,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'make an interactive result'}]}}]}
 const exec={callId:'issue30-call',agent:{id:'a',session}}
 let definition=null
 registerAdvisorStageTool({tools:{register:d=>{definition=d;return()=>{}}}},stages,{resolveAccess:async()=>({ok:true,readTools:true})})
 return {root,stages,exec,tool:args=>definition.execute(args,exec),cleanup:()=>rmSync(root,{recursive:true,force:true})}
}
const reviewInvoker=(x,runLoop)=>createAdvisor({stages:x.stages,
  resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop})

test('issue-30(a): 11 traces over 5 disjoint segments of one unchanged file land as one version row and satisfy the checkpoint',async()=>{
 const x=stageFixture()
 try{
  const task=await x.tool({action:'start_task',title:'segmented source review'})
  const stage=await x.tool({action:'define_stage',taskId:task.taskId,scope:'code',focus:'segmented source is usable',criteria:['segmented source is usable']})
  const ref={taskId:task.taskId,stageId:stage.stage.id}
  // 报告现场：同一未改动文件被分成不连续的段读取（5 段、11 行痕迹）。
  const segments=[[1,10],[21,30],[41,50],[61,70],[81,90]]
  const windows=[[1,10],[3,8],[21,30],[23,28],[41,50],[43,48],[61,70],[63,68],[81,90],[83,88],[85,86]]
  assert.ok(windows.every(([start,end])=>segments.filter(([a,b])=>start>=a&&end<=b).length===1),'每个读取窗口都落在这五个不连续区间之一')
  const trace=windows.map(([startLine,endLine])=>readRow(x.root,startLine,endLine))
  assert.equal(trace.length,11,'报告现场的痕迹行数')
  assert.equal(new Set(trace.map(r=>r.evidence.sha256)).size,1,'11 行痕迹属于同一个未改动版本')
  assert.equal(new Set(trace.map(r=>r.evidence.startLine+'-'+r.evidence.endLine)).size,11,'区间互不相同（旧实现按区间去重会留下 11 行材料）')
  assert.ok(trace.every(r=>r.evidence.selectionComplete===true),'每段都在结果上限内，段读取自身完整')
  const invoke=reviewInvoker(x,async()=>({text:reviewReport(stage.stage.checks[0].id,'segmented source is usable'),trace}))
  const out=await invoke({mode:'review_result',...ref,question:'review segmented source',files:[],evidenceRefs:[]},x.exec)
  assert.notEqual(out.stageRecording?.reason,'invalid-stage-material',JSON.stringify(out.stageRecording))
  assert.equal(out.stageRecording?.ok,true,JSON.stringify(out.stageRecording))
  const rows=out.materials.filter(m=>m.path==='app.js')
  assert.equal(rows.length,1,'按文件版本归并：11 行痕迹只产生一行材料')
  assert.equal(rows[0].readRanges.length,11,'合并行必须保留实际读过的 11 个区间')
  assert.equal(rows[0].selectionScope,'multiple-line-ranges')
  assert.equal(out.reviewPassed,true,JSON.stringify(out.stageState))
  assert.deepEqual(out.stageState.stage.checks.map(c=>[c.id,c.status]),[[stage.stage.checks[0].id,'satisfied']],'satisfied 判定必须落进台账')
  assert.equal((await x.tool({action:'advance',...ref})).ok,true)
 }finally{x.cleanup()}
})

test('issue-30(a): a genuinely changed version is not merged away and is not accepted as current',async()=>{
 const x=stageFixture()
 try{
  const task=await x.tool({action:'start_task',title:'changed version review'})
  const stage=await x.tool({action:'define_stage',taskId:task.taskId,scope:'code',focus:'source version is current',criteria:['source version is current']})
  const ref={taskId:task.taskId,stageId:stage.stage.id}
  const invoke=reviewInvoker(x,async()=>{
   const before=readRow(x.root,1,10)
   writeFileSync(join(x.root,'app.js'),sourceLines(120).map(line=>line+' // changed').join('\n'))
   const after=readRow(x.root,1,10)
   assert.notEqual(before.evidence.sha256,after.evidence.sha256,'两次读取必须真的落在不同版本上')
   return {text:reviewReport(stage.stage.checks[0].id,'source version is current'),trace:[before,after]}
  })
  const out=await invoke({mode:'review_result',...ref,question:'review both versions',files:[],evidenceRefs:[]},x.exec)
  const rows=out.materials.filter(m=>m.path==='app.js')
  assert.equal(rows.length,2,'同一路径的两个版本必须各占一行，不能按路径留下最后一份')
  assert.equal(new Set(rows.map(m=>m.sha256)).size,2)
  assert.equal(out.reviewPassed,false,'改过的版本不得被当作当前版本放行')
  assert.ok(out.stageState.stage.checks.every(c=>c.status!=='satisfied'),JSON.stringify(out.stageState.stage.checks))
  assert.equal((await x.tool({action:'advance',...ref})).ok,false)
 }finally{x.cleanup()}
})

test('issue-30(a): more than eight genuine file versions still fail closed instead of being truncated into a pass',()=>{
 const root=mkdtempSync(join(tmpdir(),'po06-issue30-limit-'))
 try{
  const stages=createAdvisorStages({home:root})
  const task=stages.startTask({sessionId:'s',title:'nine versions',sourceRequestId:'human:9',sourceText:'nine versioned files'})
  const stage=stages.defineStage({sessionId:'s',taskId:task.taskId,scope:'code',focus:'nine file versions',criteria:['all versions present']})
  const materials=Array.from({length:9},(_,i)=>{
   const body='version '+(i+1),name='f'+(i+1)+'.js'
   writeFileSync(join(root,name),body)
   return {path:name,kind:'file',status:'ready',sha256:createHash('sha256').update(body).digest('hex')}
  })
  const recorded=stages.recordReview({sessionId:'s',taskId:task.taskId,stageId:stage.stage.id,reviewId:'review-nine',
   report:{verdict:'pass',checks:[{checkId:stage.stage.checks[0].id,criterion:'all versions present',status:'satisfied',evidenceRefs:['F0']}]},materials,subjects:[]})
  assert.equal(recorded.ok,false,JSON.stringify(recorded))
  assert.equal(recorded.reason,'stage-material-limit','超过 8 个文件版本必须明确拒绝，不得静默截断成通过')
  assert.notEqual(stages.status({sessionId:'s',root,readEnabled:true}).stage.checks[0].status,'satisfied')
 }finally{rmSync(root,{recursive:true,force:true})}
})

// ——— (b) 中断调用 fixture：真实工具注册 + 真实 createAdvisor ———
const APPROVAL_EVENTS=[{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'验收运行'}]}},
  {type:'tool/result',data:{message:{content:[{type:'text',text:'tests passed'}]}}}]
const REASONING_TAIL='正在核对渲染结果与验收点'
const interrupted=async({reasoning=REASONING_TAIL,toolTarget='evidence.txt',text=''}={})=>{
 const store=createAdvisorProgress()
 const exec={callId:'issue30-partial-'+Math.random().toString(36).slice(2),agent:{session:{id:'s1',snapshotEvents:()=>APPROVAL_EVENTS}}}
 const invoke=createAdvisor({progress:store,timeoutMs:40,
  resolveRuntime:async()=>({ok:true,cfg:{provider:'p',model:'m'},readTools:true,cwd:process.cwd()}),
  runLoop:async loop=>{
   if(toolTarget)loop.onEvent({kind:'tool',tool:'read',target:toolTarget,round:1,ok:true})
   if(reasoning)loop.onDelta({reasoning,text:''})
   // 先产生部分产出，再等到点中断——避免调用开始前就被取消。
   await new Promise(resolve=>loop.signal.addEventListener('abort',resolve,{once:true}))
   return {text,trace:[],toolCalls:1}
  }})
 let definition=null
 registerAdvisorTool({tools:{register:d=>{definition=d;return()=>{}}}},invoke)
 const out=await definition.execute({mode:'review_result',question:'验收'},exec)
 return {definition,out}
}
const projectionOf=(definition,out)=>definition.output.presentationMeta({mode:'review_result'},out)
const cardTextOf=(definition,out)=>definition.presentResult({mode:'review_result'},{meta:projectionOf(definition,out)})
  .content.map(block=>String(block?.text||'')).join('\n')

test('issue-30(b): an interrupted invocation keeps the produced reasoning, activities and raw in the tool result',async()=>{
 const formed=await interrupted()
 assert.equal(formed.out.partial,true)
 assert.ok(String(formed.out.partialReasoning).includes(REASONING_TAIL),'结果对象必须交回思考尾部')
 assert.equal(formed.out.activities.length,1,'结果对象必须交回查证记录')
 assert.equal(formed.out.activities[0].target,'evidence.txt')
 const raw=await interrupted({reasoning:'',text:'{broken json report'})
 assert.ok(String(raw.out.raw).includes('broken json report'),'结果对象必须保留未采纳的原始输出')
})

test('issue-30(b): the card projection carries every retained field the result actually produced',async()=>{
 const formed=await interrupted()
 const meta=projectionOf(formed.definition,formed.out)
 const missing=[]
 if(!meta.partialReasoning)missing.push('partialReasoning')
 if(!Array.isArray(meta.activities)||!meta.activities.length)missing.push('activities')
 assert.deepEqual(missing,[],'presentationMeta 必须投影结果里已经存在的产出；缺失='+JSON.stringify(missing))
 const raw=await interrupted({reasoning:'',text:'{broken json report'})
 const rawMeta=projectionOf(raw.definition,raw.out)
 assert.equal(rawMeta.raw,raw.out.raw,'presentationMeta 必须保留 raw')
})

test('issue-30(b): the failure card shows the retained content instead of only the reason',async()=>{
 const formed=await interrupted()
 const card=cardTextOf(formed.definition,formed.out)
 assert.ok(card.includes(REASONING_TAIL),'卡面必须显示已经产出的思考尾部，实际卡面='+JSON.stringify(card))
 assert.ok(card.includes('evidence.txt'),'卡面必须显示已经跑过的查证记录，实际卡面='+JSON.stringify(card))
 const raw=await interrupted({reasoning:'',text:'{broken json report'})
 const rawCard=cardTextOf(raw.definition,raw.out)
 assert.ok(rawCard.includes('broken json report'),'卡面必须显示未采纳的原始输出，实际卡面='+JSON.stringify(rawCard))
})

// 真实前端卡片（client.js 的 AdvisorToolRow），沿用 advisor-stage-card.test.mjs 的加载方式。
const loadClientCard=()=>{
 const src=readFileSync(join(ROOT,'lib','client.js'),'utf8')
 const regs=[]
 const win={__ModuleLoader__:{load:r=>regs.push(r)}}
 const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'Fragment',
  useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{},useCallback:f=>f,useMemo:f=>f()}
 const req=name=>name==='react'?React:{}
 new Function('window','require',src)(win,req)
 const mod=regs[0].factory(req)
 mod.apply({slots:{register:()=>()=>{},inject:(slot,cb)=>cb()},locale:'en'})
 return mod
}
const renderNode=node=>{
 if(node==null||typeof node==='boolean')return ''
 if(Array.isArray(node))return node.map(renderNode).join('')
 if(typeof node==='string'||typeof node==='number')return String(node)
 if(typeof node.type==='function')return renderNode(node.type(node.props))
 return renderNode(node.children)
}
const clientCardOf=(mod,value)=>renderNode(mod.__debug.AdvisorToolRow({phase:'result',sessionId:'',callId:'issue30-card',
  block:{call:{argsRaw:{mode:'review_result',question:'验收'}},content:[{type:'text',text:JSON.stringify(value)}]}}))

test('issue-30(b): the rendered card shows the retained reasoning instead of the title alone',async()=>{
 const mod=loadClientCard()
 const formed=await interrupted()
 const withContent=clientCardOf(mod,formed.out)
 assert.match(withContent,/Partial output|保留部分内容/,'有真实产出时保留内容标题可以出现')
 assert.ok(withContent.includes(REASONING_TAIL),'真实产出必须出现在卡面上，而不是只给标题')
})

test('issue-30(b): the retained-content title does not appear when only the fixed note survived',async()=>{
 const mod=loadClientCard()
 const formed=await interrupted()
 // 宿主只持久化了固定提示语的形态：三类产出都为空，只剩下 note。
 const noteOnly={...formed.out,partialReasoning:undefined,activities:undefined,raw:undefined}
 const noteCard=clientCardOf(mod,noteOnly)
 assert.doesNotMatch(noteCard,/Partial output|保留部分内容/,'只有固定提示语时不得声称保留了内容')
})
