import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {dirname,resolve,join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath,pathToFileURL} from 'node:url'
import * as actual from '../lib/optimizer-protocol.js'
import {createAdvisor,ADVISOR_PARAMETERS} from '../lib/advisor.js'
import {createAdvisorProgress} from '../lib/advisor-progress.js'
import {interpretViaLlm} from '../lib/index.js'
import {prepareEnglishInterpretation,protectEnglishLiterals,createEnglishMode,finishEnglishInput} from '../lib/english-mode.js'
import {prepareAdvisorMaterials} from '../lib/advisor-materials.js'
import {mergeReadMaterialVersions} from '../lib/advisor-read-materials.js'
const here=dirname(fileURLToPath(import.meta.url))
const ref=[resolve(here,'../../.po06-tmp/exact-turn305'),resolve(here,'../../../exact-turn305')].find(p=>existsSync(join(p,'po06/lib/optimizer-protocol.js')))
// 2026-10-19 issue #36：参考树是作者本机的重建目录（.po06-tmp 未入库）。
// 干净检出/CI 上不许因为缺它而在加载阶段抛错：整份套件跳过并打印原因，
// 由发版门（po06/scripts/check-release.mjs --strict）负责要求它存在。
const SKIP=ref?false:'reference tree missing: .po06-tmp/exact-turn305 (rebuild from git history; the release gate requires it)'
if(SKIP)console.error('[turn305-parity] SKIP — '+SKIP)
const original=ref?await import(pathToFileURL(join(ref,'po06/lib/optimizer-protocol.js'))):null
const historicalAdvisor=ref?await import(pathToFileURL(join(ref,'po06/lib/advisor.js'))):null
const historicalScopes=ref?await import(pathToFileURL(join(ref,'po06/lib/advisor-scopes.js'))):null
const scopes=await import('../lib/advisor-scopes.js')
const originalContribution=ref?await import(pathToFileURL(join(ref,'po06/lib/advisor-contribution.js'))):null
const contribution=await import('../lib/advisor-contribution.js')
const human={type:'user/message',seq:1,data:{id:'m1',source:{kind:'user'},content:[{type:'text',text:'Make the original requested artifact.'}]}}
const events=[human,{type:'tool/call',seq:2,data:{callId:'c1',name:'read',arguments:{file_path:'artifact.txt'}}},{type:'tool/result',seq:3,data:{message:{toolCallId:'c1',content:[{type:'text',text:'ACTUAL observed content'}]}}}]
const exec={agent:{session:{id:'exact-parity',snapshotEvents:()=>events}}}
const report={verdict:'suggestion',summary:'Concrete gain',contribution:'Adoptable method, without inventing requirements.',assumptions:[],findings:[],checks:[],nextStep:'Use if useful.',stopCondition:'Check facts before use.'}
const stream=(text,usage={inputTokens:1,outputTokens:2,totalTokens:3})=>(async function*(){yield{type:'text-delta',text};yield{type:'usage',usage};yield{type:'finish',reason:{kind:'stop'}}})()

test('optimizer contract: format/options stay historical; core and tiers are the deliberate wish-amplifier change', { skip: SKIP },()=>{
 // 2026-10-18 用户明确改口径：优化 = 扩充"愿望内容"（方向性要求），不是替工作模型写实现。
 // 因此 OPTIMIZER_CORE / OPTIMIZER_TIERS 与历史 checkpoint **有意不同**；其余必须逐字一致，
 // 这样"漂移"仍然只有一个已知出口，而不是整块失守。
 assert.deepEqual(actual.OPTIMIZER_OPTIONS,original.OPTIMIZER_OPTIONS,'选项契约不许漂移')
 assert.notDeepEqual(actual.OPTIMIZER_FORMAT,original.OPTIMIZER_FORMAT)
 assert.match(actual.OPTIMIZER_FORMAT.zh,/方向性要求/,'add 的每一项必须是方向性要求')
 assert.notDeepEqual(actual.OPTIMIZER_CORE,original.OPTIMIZER_CORE)
 assert.notDeepEqual(actual.OPTIMIZER_TIERS,original.OPTIMIZER_TIERS)
 assert.match(actual.OPTIMIZER_CORE.zh,/愿望扩充器/)
 assert.match(actual.OPTIMIZER_CORE.zh,/不给代码/)
 assert.match(actual.OPTIMIZER_CORE.zh,/不缩小、不改写、不删减/)
 assert.match(actual.OPTIMIZER_TIERS.zh.heavy,/阶段拆分/)
 assert.doesNotMatch(actual.OPTIMIZER_CORE.zh,/可直接采用的方法与内容/,'旧的"贡献方法"口径必须已经退出')
 for(const language of ['zh','en'])for(const tier of ['light','standard','heavy']){
  const text=actual.composeOptimizerSystem({language,tier}).text
  assert.ok(text.includes(actual.OPTIMIZER_CORE[language]))
  assert.ok(text.includes(actual.OPTIMIZER_TIERS[language][tier]))
 }
 assert.equal(actual.OPTIMIZER_PROTOCOL_VERSION,'3');assert.deepEqual(actual.OPTIMIZER_BASELINE_ROUNDS,[300,301,302,303,304,305])
})

test('normal packet and source message are historical, without later consult-opportunity policy', { skip: SKIP },()=>{
 for(const language of ['zh','en']){
  const value={intent:{text:language==='zh'?'原任务，不强化否定。':'Original task, no stronger negation.',relation:'continue'},clarify:[],add:[language==='zh'?'实际构造。':'Actual useful construction.'],ask:[],consult:{mode:'develop_approach',focus:'Later invented opportunity',reason:'Not part of turn305'}}
  assert.equal(actual.renderOptimizerPacket(value,language),original.renderOptimizerPacket(value,language))
  assert.equal(actual.renderOptimizerPacket(value,language).includes('Later invented opportunity'),false)
 }
 const source={userText:'Explicit original task.',context:'Permitted context.',observations:[],retryEmpty:false,englishMode:false}
 assert.equal(actual.buildOptimizerUserMessage(source),original.buildOptimizerUserMessage(source))
})

test('unchanged capability/contribution authority stays historical; claim-policy differences are explicit', { skip: SKIP },()=>{
 assert.equal(readFileSync(new URL('../lib/advisor-stage-tool.js',import.meta.url),'utf8'),readFileSync(join(ref,'po06/lib/advisor-stage-tool.js'),'utf8'),'advisor-stage-tool.js 逐字节一致')
 // 2026-10-19 用户改口径：顾问贡献改成"愿望式方向"（一条一句、点到为止、只有缺陷可稍具体）。
 // 漂移必须**可枚举**：capability.js 只换了两处文案，其余逐字节与历史一致。
 const revertCapability=(s)=>s
  .replace('【解题方向 · 机器提出的方向要求（不是新增用户要求）】','【解题贡献 · 机器建议，以原话和实际依据为准】')
  .replace('这些方向只为抬高成果上限；按用户原话判断是否适用，采纳或反驳都可以，它们不改变用户目标与授权。','判断该贡献是否适用于当前任务；采纳、修改或反驳均可，建议不改变用户目标和授权。')
 const stripComments=(s)=>s.split('\n').filter((l)=>!/^\s*\/\//.test(l)).join('\n')
 assert.equal(stripComments(revertCapability(readFileSync(new URL('../lib/capability.js',import.meta.url),'utf8'))),stripComments(readFileSync(join(ref,'po06/lib/capability.js'),'utf8')),'capability.js 的差异必须只有那两处文案（注释不计）')
 // 与历史的差异必须**逐项列出来**（本测试的用处就是"看不出来的漂移"为零）。现在有三处：
 //   subjectPaths（新增，只绑定版本不新增验收目标）、requiredScopes/requiredReviews（GitHub #33A）。
 // 2026-10-19：贡献改成"方向性要求"后，mode 的描述也改了（与历史有意不同；枚举集合不变）。
 const {subjectPaths,requiredScopes,requiredReviews,mode:currentMode,...properties}=ADVISOR_PARAMETERS.properties
 // 历史那一侧也要把同样三项摘掉再比 —— 否则比的是"谁少两个键"，不是"其余是否逐字一致"。
 const {requiredScopes:_hScopes,requiredReviews:_hReviews,mode:historicalMode,...historicalProperties}=historicalAdvisor.ADVISOR_PARAMETERS.properties
 assert.deepEqual(currentMode.enum,historicalMode.enum,'模式集合不变')
 assert.ok(currentMode.description.includes('方向性要求')&&historicalMode.description.includes('贡献具体解法'),'mode 描述是有意改的')
 assert.deepEqual({...ADVISOR_PARAMETERS,properties},{...historicalAdvisor.ADVISOR_PARAMETERS,properties:historicalProperties});assert.ok(subjectPaths)
 // GitHub #33A：这两个参数的**全部**消费方都在 delivery 分支内，非 delivery 下是纯 no-op。
 // 历史实现按硬错误拒掉整次调用（真机某会话 21 连败 0 成功），而 schema 的 enum 又把 8 个值全给 ⇒ 照 schema 选值必被拒。
 // 现在：enum 收紧到"delivery 里真正允许的维度"、描述写明 no-op 与拒绝理由；其余字段逐项与历史一致。
 const historicalDelivery={requiredScopes:historicalAdvisor.ADVISOR_PARAMETERS.properties.requiredScopes,requiredReviews:historicalAdvisor.ADVISOR_PARAMETERS.properties.requiredReviews}
 assert.deepEqual(historicalDelivery.requiredScopes.items.enum,historicalScopes.ADVISOR_SCOPES,'历史是全量 enum')
 assert.deepEqual(requiredScopes.items.enum,scopes.DELIVERY_ITEM_SCOPES)
 assert.deepEqual(requiredReviews.items.properties.scope.enum,scopes.DELIVERY_ITEM_SCOPES)
 for(const key of ['requiredScopes','requiredReviews']){
  assert.equal(ADVISOR_PARAMETERS.properties[key].type,historicalDelivery[key].type,key+' type 不变')
  assert.ok(ADVISOR_PARAMETERS.properties[key].description.includes('no-op'),key+' 描述要写明非 delivery 下是 no-op')
 }
 assert.equal(historicalDelivery.requiredReviews.items.required.join(),'scope,focus','历史必填项不变')
 assert.equal(requiredReviews.items.required.join(),'scope,focus')
 assert.equal(historicalDelivery.requiredScopes.items.enum.includes('general'),true)
 assert.equal(requiredScopes.items.enum.includes('general'),false,'schema 不许再给出 delivery 内非法的取值')
 // 贡献提示词是**有意**改的（2026-10-19 愿望式）：不再与历史逐字一致，但边界必须还在。
 for(const mode of ['develop_approach','improve_result'])for(const en of [false,true]){
  const sys=contribution.contributionSystem(mode,en)
  assert.ok(sys.includes(en?'Raise the ceiling':'往上抬'),mode+' '+(en?'en':'zh')+' 要写明「往上抬」')
  assert.ok(sys.includes(en?'no code':'不写代码'),'不写代码')
  assert.ok(sys.includes(en?'Defect:':'缺陷：'),'只有缺陷可稍具体')
  assert.ok(sys.includes('checks'),'checks 仍要显式声明为空')
  assert.notEqual(sys,originalContribution.contributionSystem(mode,en),'这是有意的口径变化')
 }
 for(const mode of ['develop_approach','improve_result','review_result'])for(const scope of ['general','code','appearance']){
  const args={mode,scope,question:'Actual question',focus:'Actual object'};if(scope!=='appearance'||mode!=='review_result')assert.deepEqual(scopes.scopePolicy(args),historicalScopes.scopePolicy(args));else {assert.equal(scopes.scopePolicy(args).imagesOnly,false);assert.equal(scopes.scopePolicy(args).allowTools,true)}
 }
})

test('actual adviser system and supplied history match turn305 for both contribution modes', { skip: SKIP },async()=>{
 const root=mkdtempSync(join(tmpdir(),'round305-advice-'));writeFileSync(join(root,'artifact.txt'),'ACTUAL source')
 try{for(const mode of ['develop_approach','improve_result'])for(const englishMode of [false,true]){
  const inputs=[]
  for(const make of [historicalAdvisor.createAdvisor,createAdvisor]){
   const invoke=make({resolveRuntime:async()=>({ok:true,cwd:root,readTools:true,englishMode,cfg:{provider:'offline',model:'no-network',reasoningEffort:'max'},llm:{}}),runLoop:async o=>{inputs.push({system:o.system,messages:o.messages,count:o.count,rootListing:o.rootListing});return{text:JSON.stringify({...report,findings:[{text:'Observed artifact evidence',evidenceRefs:['F0']}]}),trace:[],toolCalls:0,usage:{totalTokens:3}}}})
   const out=await invoke({mode,scope:'code',focus:'Artifact source',question:'Give a concrete method',files:[{path:'artifact.txt',purpose:'Actual artifact'}]},exec);assert.equal(out.ok,true,JSON.stringify({mode,englishMode,reason:out.reason}))
  }
  // The bounded observedRanges index is new; actual sent content/system/history are unchanged here.
  const normalize=x=>JSON.parse(JSON.stringify(x),(k,v)=>k==='observedRanges'?undefined:v)
  const stripPayload=x=>({...x,messages:x.messages.map(m=>({...m,content:m.content.map(b=>b.type==='text'?{...b,text:JSON.stringify(normalize(JSON.parse(b.text)))}:b)}))})
  // system 提示是有意改的（愿望式方向）；其余（messages/count/rootListing）必须与历史一致。
  const noSystem=(x)=>({...stripPayload(x),system:undefined})
  assert.deepEqual(noSystem(inputs[0]),noSystem(inputs[1]),mode+' '+englishMode)
  assert.notEqual(inputs[0].system,inputs[1].system,mode+' '+englishMode+'：贡献 system 提示是有意改过的')
  assert.ok(/往上抬|Raise the ceiling/.test(inputs[1].system),mode+' '+englishMode+'：当前 system 是愿望式口径')
 }}finally{rmSync(root,{recursive:true,force:true})}
})

test('faithful English task and ready advice survive missing-task fallback', { skip: SKIP },async()=>{
 const service=createEnglishMode(),mark=String.fromCharCode(96),originalText='检查 '+mark+'src/layout.js'+mark+'，答复中文。'
 const p=protectEnglishLiterals(originalText)
 const parsed=prepareEnglishInterpretation({intent:{text:'Inspect implementation.',relation:'continue'},englishTask:'Inspect '+p.literals[0].token+'; respond in Chinese.',clarify:[],add:['Useful method for '+p.literals[0].token],ask:[]},originalText,p)
 assert.ok(parsed.value.add[0].includes('src/layout.js'));assert.ok(parsed.translation.text.includes('respond in Chinese'))
 const token=service.begin('english-parity','m1',originalText),ready={ok:true,text:'Actual validated English advice'}
 const finish=await finishEnglishInput({service,token,enabled:()=>true,produced:{packet:ready,englishTranslation:null},translate:async()=>({text:'Inspect '+mark+'src/layout.js'+mark+'; respond in Chinese.',source:'test-translation'})})
 assert.equal(finish.ok,true);assert.equal(finish.assistanceAvailable,true);assert.equal(finish.fallback,true);assert.equal(finish.translation.warnings.at(-1).reason,'translation-fallback-assistance-kept')
})

test('unavailable paths may be cited but never support result satisfaction or merged versions', { skip: SKIP },async()=>{
 const root=mkdtempSync(join(tmpdir(),'round305-missing-'))
 try{const prepared=await prepareAdvisorMaterials({args:{files:[{path:'not-here.txt',purpose:'Claimed file'}]},root,enabled:true});assert.ok(prepared.evidenceIds.has('F0'));assert.equal(prepared.resultIds.has('F0'),false)}finally{rmSync(root,{recursive:true,force:true})}
 const rows=[{path:'a.txt',kind:'file',sha256:'a'.repeat(64),startLine:1,endLine:3,status:'ready',selectionComplete:true,wholeFileComplete:false},{path:'a.txt',kind:'file',sha256:'a'.repeat(64),startLine:40,endLine:44,status:'ready',selectionComplete:true,wholeFileComplete:false}]
 const merged=mergeReadMaterialVersions(rows);assert.equal(merged.length,1);assert.equal(merged[0].readRanges.length,2);assert.equal(merged[0].wholeFileComplete,false)
 assert.equal(mergeReadMaterialVersions([...rows,{...rows[0],sha256:'b'.repeat(64)}]).length,2)
})

test('the user can cancel after the former deadline without any default total timer', { skip: SKIP },async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1000})
 let entered,modelSignal;const ready=new Promise(r=>{entered=r}),controller=new AbortController()
 const invoke=createAdvisor({progress:createAdvisorProgress(),resolveRuntime:async()=>({ok:true,readTools:false,cfg:{provider:'offline',model:'test'},llm:{stream:o=>(async function*(){modelSignal=o.signal;yield{type:'reasoning-delta',text:'Actual pending evidence analysis'};entered();await new Promise(r=>o.signal.addEventListener('abort',r,{once:true}))})()}})})
 const pending=invoke({mode:'diagnose_failure',question:'Inspect existing evidence.'},{...exec,signal:controller.signal})
 await ready;t.mock.timers.tick(80000);assert.equal(modelSignal.aborted,false,'默认没有总截止：旧 300s 熔断已取消（80s 不许动它）');controller.abort()
 const out=await pending;assert.equal(out.reason,'advisor-cancelled');assert.equal(out.partial,true);assert.equal(out.diagnosticOnly,true)
 // ⚠ 有意差异（GitHub #34）：**没有任何产出**时 90s 空闲判死，不再干等满旧熔断。
 //   这不是"总截止"：只要还有增量产出就永远不会触发（防误报用例见 advisor-stall.test.mjs）。
 //   要"永远不设任何上限"就显式 DSH_PO06_ADVISOR_STALL_MS=0 —— 下面第三段同时证明那条开关真的生效。
 // 这一支刻意**一个增量都不吐**：有任何产出就会重置空闲计时，测试就变成和心跳赛跑（实测会挂住）。
 const hang=o=>(async function*(){await new Promise(r=>{if(o.signal.aborted)return r();o.signal.addEventListener('abort',r,{once:true})})})()
 // ⚠ 计时器是**进入模型调用时**才起表的，所以必须等流真的被创建（gate）再推进假时钟：
 //   只 await 一个 microtask 会在起表之前就把时钟推过去，计时器随后才armed ⇒ 永远等不到（实测挂死）。
 const makeGuard=(opts)=>{let mark;const gate=new Promise(r=>{mark=r})
  const invoke=createAdvisor({progress:createAdvisorProgress(),...opts,resolveRuntime:async()=>({ok:true,readTools:false,cfg:{provider:'offline',model:'test'},llm:{stream:o=>{modelSignal=o.signal;mark();return hang(o)}}})})
  return {invoke,gate}}
 const g1=makeGuard({})
 const guarded=g1.invoke({mode:'diagnose_failure',question:'Inspect existing evidence.'},{...exec,signal:new AbortController().signal})
 await g1.gate;t.mock.timers.tick(95000)
 // 一个字节都没产出时走的是"没有可交回内容"那条分支 ⇒ 结论在 reason 上（有产出时才额外带 cut）。
 assert.equal((await guarded).reason,'advisor-stall-timeout','无产出 90s 判死')
 const g2=makeGuard({stallMs:0}),controller2=new AbortController()
 const noGuard=g2.invoke({mode:'diagnose_failure',question:'Inspect existing evidence.'},{...exec,signal:controller2.signal})
 await g2.gate;t.mock.timers.tick(900000)
 assert.equal(modelSignal.aborted,false,'stallMs=0 ⇒ 连空闲判死也没有，只能靠用户取消')
 controller2.abort();const out3=await noGuard;assert.equal(out3.reason,'advisor-cancelled')
})

test('paid fallback accounting is isolated from normal successful output', { skip: SKIP },async()=>{
 const root=mkdtempSync(join(tmpdir(),'round305-cost-'))
 try{let count=0;const llm={stream:()=>stream(++count===1?'Not optimizer JSON.':JSON.stringify({intent:{text:'Actual request',relation:'continue'},clarify:[],add:[],ask:[]}),count===1?{totalTokens:5}:{totalTokens:7})}
 const out=await interpretViaLlm({llm,cfg:{provider:'offline',model:'test'},system:'JSON.',userPrompt:'Original request',tools:{enabled:true,root,count:1}})
 assert.equal(out.usage.totalTokens,12);assert.equal(out.usageComplete,true);assert.equal(count,2)
 }finally{rmSync(root,{recursive:true,force:true})}
})
