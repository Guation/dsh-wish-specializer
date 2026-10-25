import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as protocol from '../lib/optimizer-protocol.js'
import { adapter as productionAdapter, buildInterpreterProtocol } from '../lib/index.js'
import { createCapability } from '../lib/capability.js'
import { policyFor } from '../lib/policy.js'
import { prepareEnglishInterpretation } from '../lib/english-mode.js'

const production = '车身轮廓、反光和装配关系应有统一的真实比例与精密感。'
const scaffold = '值得为制作建立可复用的局部修改与自反馈能力，让变化能及时对应到具体部件，减少反复截图后重读整段代码的消耗。'
const question = '更偏向优雅GT还是激进超跑？'
const value = (over={}) => ({intent:{text:'做一台可预览和驾驶的精细跑车',relation:'new'},add:[production],scaffold:[scaffold],ask:[question],...over})
const parse = value => protocol.parseOptimizerValue(value,{sessionId:'s',messageId:'m1',baseInputRevision:1,causeId:'interpret:m1'})
function fixture(capability=createCapability()) {
   const a=new productionAdapter.constructor();a.capability=capability;a.services.agents={get:()=>({})};a.policyNow=()=>({advisor:false})
   return a
}

test('three model-authored lists reach the exact requested sections in the requested order',()=>{
 const parsed=parse(value());assert.equal(parsed.ok,true)
 const packet=protocol.renderOptimizerPacket(parsed.optimizer,'zh')
 const headings=['【制作建议】','【临时脚手架建议】','【Ask用户(ask_user_question)】']
 assert.deepEqual([...packet.matchAll(/^【.*】$/gm)].map(m=>m[0]),headings)
 for(const text of [production,scaffold,question])assert.ok(packet.includes(text))
 assert.match(packet,/请优先考虑/);assert.match(packet,/不自动成为逐条必做的硬性要求/)
 assert.doesNotMatch(packet,/必须先做|临时工具箱|工具信封|stopWhen|inspect|未定时假设/)
 assert.deepEqual(parsed.optimizer.scaffold,[scaffold])
 assert.equal(parsed.patch,undefined)
 assert.deepEqual(parsed.support,{mode:'none'})
})

test('scaffolding is only the model’s explicit list: no keyword-triggered fallback or invented tool',()=>{
 const raw=value({intent:{text:'极其精细的three.js模型，所有地方都做到极致，可驾驶',relation:'new'},scaffold:undefined})
 const parsed=parse(raw);assert.equal(parsed.ok,true);assert.deepEqual(parsed.optimizer.scaffold,[])
 assert.equal(protocol.renderOptimizerPacket(parsed.optimizer).includes('【临时脚手架建议】'),false)
 assert.equal(protocol.dropFormContradictions,undefined)
 assert.equal(protocol.inferToolbox,undefined)
 const withOldToolbox=parse({...raw,toolbox:{recommendation:'build',reason:'do everything'}})
 assert.equal(protocol.renderOptimizerPacket(withOldToolbox.optimizer).includes('do everything'),false)
})

test('only scaffold directions create a real packet and remain canonical advice',async()=>{
 const a=fixture(),s={id:'scaffold-only'};let calls=0
 const out=await a.handleInput(s,{messageId:'m1',text:'需要改善制作反馈',interpret:async()=>{calls++;return JSON.stringify(value({add:[],scaffold:[scaffold],ask:[]}))}})
 assert.equal(calls,1);assert.equal(out.outcome,'committed');assert.equal(out.zeroAddition,false)
 assert.match(out.packet.text,/【临时脚手架建议】/);assert.doesNotMatch(out.packet.text,/【制作建议】|【Ask用户/)
 assert.equal(out.packet.text,a.getWorkingText(s.id))
  assert.equal(out.ok,true);assert.equal(out.status,'ready')
  assert.deepEqual(out.optimizer.scaffold,[scaffold])
 assert.deepEqual(a.capability.status(s.id).current.optimizer.scaffold,[scaffold])
})

test('optional malformed scaffold does not destroy production directions or user questions',()=>{
 for(const [supplied,expected] of [['single direction',['single direction']],[{command:'run'},[]],[['good',{code:'bad'}],['good']]]){
  const p=parse(value({scaffold:supplied}));assert.equal(p.ok,true);assert.deepEqual(p.optimizer.scaffold,expected)
  assert.ok(p.warnings.some(x=>x.startsWith('scaffold')))
  const text=protocol.renderOptimizerPacket(p.optimizer);assert.ok(text.includes(production));assert.ok(text.includes(question))
 }
})

test('questions are sufficient without options; old choices never appear as answers',()=>{
 const text=protocol.renderOptimizerPacket(parse(value({add:[],scaffold:[],ask:['车型气质？'],decide:[{question:'场景？',options:['赛道','公路'],assumption:'赛道'}]})).optimizer)
 assert.match(text,/请调用 ask_user_question，自行组织合适的选项/)
 assert.ok(text.includes('车型气质？'));assert.ok(text.includes('场景？'))
 assert.doesNotMatch(text,/选项：|赛道 \/ 公路|未定时假设|已选：/)
})

test('no hard-coded removal of a direction just because a form term occurs in it',()=>{
 const advice='楔形或长头的差异需由用户决定，所有候选都应保持统一的比例与装配可信度。'
 const p=parse(value({add:[advice]}))
 assert.ok(p.optimizer.add.includes(advice));assert.ok(protocol.renderOptimizerPacket(p.optimizer).includes(advice))
 for(const language of ['zh','en'])assert.match(protocol.composeOptimizerSystem({language}).text,/不许自相矛盾|No self-contradiction/)
})

test('one shared 3000-token budget reaches policies, system and actual user message in both languages',()=>{
 for(const tier of ['light','standard','heavy']){
  const p=policyFor({tier});assert.equal(p.packetBudgetTokens,3000)
  for(const language of ['zh','en']){
   const system=protocol.composeOptimizerSystem({tier,language})
   assert.equal(system.revision,'scaffold-directions-1');assert.ok(system.text.includes('3000'))
   assert.ok(system.text.includes('scaffold'));assert.ok(system.text.includes('ask_user_question'))
   assert.equal(system.parts.filter(x=>x.key==='guidance').length,1)
  }
 }
 const request=JSON.parse(protocol.buildOptimizerUserMessage({userText:'用户原话'}))
 assert.equal(request.originalText,'用户原话');assert.equal(request.outputBudgetTokens,3000)
})

test('custom core, tool path and fallback still carry the same model scaffold contract',async()=>{
 const home=mkdtempSync(join(tmpdir(),'scaffold-core-'))
 try{
  const core='My custom expression style.';writeFileSync(join(home,'po06-prompt.md'),core)
  const p=await buildInterpreterProtocol({home,toolsEnabled:true,englishMode:false})
  for(const text of [p.text,p.noToolsText]){
   assert.ok(text.startsWith(core));assert.ok(text.includes(protocol.OPTIMIZER_FORMAT.zh));assert.ok(text.includes(protocol.OPTIMIZER_GUIDANCE.zh))
   assert.doesNotMatch(text,/none\|reuse\|build\|inspect|taskToolbox|stopWhen/)
  }
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('model scaffold suggestions survive the existing store, and expire normally on a new input',()=>{
 const home=mkdtempSync(join(tmpdir(),'scaffold-store-'))
 try{
  const service=createCapability({home,namespace:'test'}),token=service.beginInput('s','m1','原话')
  service.settle('s',token,parse(value()))
  const restored=createCapability({home,namespace:'test'})
  assert.deepEqual(restored.status('s').current.optimizer.scaffold,[scaffold])
  restored.beginInput('s','m2','继续');assert.equal(restored.status('s').current.optimizer,null)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('cancellation and supersession cannot inject stale scaffold directions',async()=>{
 const a=fixture(),s={id:'supersede'};let finish,entered
 const start=new Promise(r=>{entered=r})
 const old=a.handleInput(s,{messageId:'old',text:'old',interpret:()=>{entered();return new Promise(r=>{finish=r})}})
 await start
 const latest=await a.handleInput(s,{messageId:'new',text:'new',interpret:async()=>JSON.stringify(value({scaffold:['current direction']}))})
 finish(JSON.stringify(value({scaffold:['outdated direction']})))
 assert.equal((await old).outcome,'superseded-input');assert.equal(a.getWorkingText(s.id),latest.packet.text)
 assert.equal(a.getWorkingText(s.id).includes('outdated direction'),false)
 const abort=new AbortController()
 const result=await a.handleInput(s,{messageId:'cancel',text:'cancel',signal:abort.signal,interpret:async()=>{abort.abort();return JSON.stringify(value())}})
 assert.equal(result.outcome,'aborted');assert.equal(a.getWorkingText(s.id),'')
})

test('English normalization restores literals in scaffold and questions independently of task translation',()=>{
 const request='Create a model.'
 const normalized=prepareEnglishInterpretation({intent:{text:request,relation:'new'},add:['Coherent highlights'],scaffold:['Comparable local feedback'],ask:['Which setting?'],englishTask:request},request)
 assert.deepEqual(normalized.value.scaffold,['Comparable local feedback'])
 assert.equal(normalized.translation.text,request)
 const mixed=prepareEnglishInterpretation({intent:{text:request,relation:'new'},scaffold:['重复中文建议'],englishTask:request},request)
 assert.deepEqual(mixed.value.scaffold,['重复中文建议']);assert.equal(mixed.translation.text,request)
 assert.ok(mixed.warnings.some(w=>w.reason==='untranslated-optional-assistance-preserved'))
})

test('a mismatched closer is repaired structurally and the recovery is recorded',async()=>{
  const { extractJson, parseInterpreterOutput } = await import('../lib/interpreter.js')
  // Real observed failure (2026-10-21): the model closed `ask` with '}' instead of ']'.
  const broken='{"intent":{"text":"t","relation":"new"},"add":["a"],"scaffold":["s"],"ask":["q1","q2"}'
  assert.throws(()=>JSON.parse(broken),'the raw text is genuinely invalid JSON')
  const fixed=extractJson(broken)
  assert.equal(fixed.ok,true);assert.equal(fixed.recovered,'bracket-repair');assert.equal(fixed.value.ask.length,2)
  const parsed=parseInterpreterOutput(broken,{sessionId:'s',messageId:'m',baseRevision:1,baseInputRevision:1,causeId:'c'})
  assert.equal(parsed.ok,true)
  assert.ok(parsed.warnings.some(w=>w.startsWith('json-bracket-repair')),'repair is visible, not silent')
})

test('repair never invents content: truncated strings stay failures',async()=>{
  const { extractJson } = await import('../lib/interpreter.js')
  // No closing brace at all: nothing to repair, and certainly nothing invented.
  assert.equal(extractJson('{"intent":{"text":"half written intent').ok,false)
  // A brace inside an unterminated string must be refused, not "repaired" into a fake object.
  const refused=extractJson('{"a":"oops}')
  assert.equal(refused.ok,false)
  assert.equal(refused.repairRefused,'unterminated-string')
  const unclosed='{"intent":{"text":"t","relation":"new"},"add":["a"'
  const closed=extractJson(unclosed)
  assert.equal(closed.ok,true);assert.equal(closed.recovered,'bracket-repair')
})

test('环境已有能力优先复用：能力清单进请求，脚手架纪律写清先复用再构建', async () => {
  const { buildOptimizerUserMessage, OPTIMIZER_GUIDANCE } = await import('../lib/optimizer-protocol.js')
  const msg = JSON.parse(buildOptimizerUserMessage({ userText: '做一个跑车', capabilities: ['bash', 'read', 'grep'] }))
  assert.deepEqual(msg.availableCapabilities, ['bash', 'read', 'grep'], '能力清单只作为数据传入')
  assert.equal(msg.originalText, '做一个跑车', '原话不变')
  const noCap = JSON.parse(buildOptimizerUserMessage({ userText: 'x' }))
  assert.equal('availableCapabilities' in noCap, false, '取不到能力时不要塞空字段')
  assert.match(OPTIMIZER_GUIDANCE.zh, /先看环境/, '纪律：先看环境')
  assert.match(OPTIMIZER_GUIDANCE.zh, /复用/, '纪律：优先复用')
  assert.match(OPTIMIZER_GUIDANCE.zh, /缺这项能力/, '纪律：缺了才临时构建')
})
