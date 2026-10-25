import test from 'node:test'
import assert from 'node:assert/strict'
import {protectEnglishLiterals,restoreEnglishTranslation,validateEnglishExcerpt,createEnglishMode,prepareEnglishInterpretation,finishEnglishInput,resolveEnglishInterpretation,extractTranslationJson,ENGLISH_TRANSLATE_MAX_ATTEMPTS} from '../lib/english-mode.js'
import {EN_INTERPRETER,EN_CAPABILITY,EN_SELECT,EN_FEEDBACK} from '../lib/english-prompts.js'
import {parseInterpreterOutput} from '../lib/interpreter.js'
import {reduce} from '../lib/reducer.js'
import {createState} from '../lib/schema.js'
import {compileAudited} from '../lib/compiler.js'
import {createCapability} from '../lib/capability.js'
import {normalizeSettings} from '../lib/settings.js'
import {effectiveSettings} from '../lib/policy.js'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const cfg={provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'max'}
const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.children)]
async function* response(text){yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}}}
test('literal protection keeps code, paths, URLs, numbers and exact UI text intact',()=>{
 const source='不要读取其它文件。创建 '+String.fromCharCode(96)+'变量中文'+String.fromCharCode(96)+'，保存到 @"D:/项目/结果.html"，网址 https://example.com/a?v=3 ，按钮文字必须为“开始”，数量为 12。'
 const p=protectEnglishLiterals(source)
 assert.ok(p.literals.some(l=>l.value==='开始'))
 const english='Do not read other files. '+p.literals.map(l=>l.token).join(' ')
 const result=restoreEnglishTranslation(p,english)
 for(const l of p.literals)assert.ok(result.text.includes(l.value))
 assert.throws(()=>restoreEnglishTranslation(p,english.replace(p.literals[0].token,'')),/literal/)
 assert.throws(()=>restoreEnglishTranslation(p,english+' '+p.literals[0].token),/literal/)
})
test('original requirement and translated excerpt stay separate through reducer/compiler',()=>{
 const p=parseInterpreterOutput(JSON.stringify({ops:[{op:'add_item',item:{id:'req-1',kind:'user_requirement',quote:'不要读取其它文件',englishQuote:'Do not read other files',text:'Do not read other files',scope:'turn',sourceRefs:[{kind:'human',sessionId:'s',messageId:'m'}]}}],understanding:{summary:'Build the requested result',relation:'new',action:'execute'}}),{userText:'不要读取其它文件，制作单HTML。',sessionId:'s',messageId:'m',baseRevision:0,baseInputRevision:0,englishMode:true})
 assert.equal(p.patch.ops[0].item.text,'不要读取其它文件')
 const state=reduce(createState({sessionId:'s',taskId:'t'}),p.patch).state
 assert.equal(state.items[0].sourceQuote,'不要读取其它文件')
 assert.equal(state.items[0].englishText,'Do not read other files')
 const result=compileAudited(state,{language:'en',budget:3000})
 assert.equal(result.ok,true);assert.match(result.text,/Do not read other files/);assert.ok(!result.text.includes('不要读取'))
 assert.equal(validateEnglishExcerpt('保存到 D:/目录/a.html','Save to D:/other/a.html'),false)
})
test('translation uses no tools or new output cap, caches separately, and refuses late records',async()=>{
 const home=mkdtempSync(join(tmpdir(),'english-mode-'));try{
 let calls=0,request
 const service=createEnglishMode({home})
 const llm={resolveModelInfo:async()=>({reasoning:{efforts:[{id:'low'},{id:'max'}]}}),stream:o=>{calls++;request=o;return response(JSON.stringify({translation:'Do not read other files. Create a single HTML application.'}))}}
 const first=await service.translate('不要读取其它文件。制作单HTML。',{llm,cfg})
 assert.equal(request.reasoningEffort,'low');assert.deepEqual(request.tools,[]);assert.equal(request.maxTokens,undefined)
 assert.equal(first.translated,true)
 assert.equal((await service.translate('不要读取其它文件。制作单HTML。',{llm,cfg})).cached,true);assert.equal(calls,1)
 assert.equal((await service.translate('Reply in Chinese.',{llm,cfg})).text,'Reply in Chinese.');assert.equal(calls,1)
 const stale=service.begin('s','m1','旧任务'),fresh=service.begin('s','m2','新任务')
 assert.throws(()=>service.record(stale,'old task'),/superseded/)
 service.record(fresh,'new task');assert.equal(service.get('s').originalText,'新任务')
 assert.equal(service.bind('s','real-m2','new task'),true)
 const restored=createEnglishMode({home});assert.equal(restored.get('s').translatedText,'new task')
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('explicit English submission binds the same source task rather than resetting it',()=>{
 const c=createCapability(),token=c.beginInput('s','po06-intercept-m','不要读取其它文件')
 c.settle('s',token,{understanding:{summary:'Do not read other files',relation:'new',action:'execute'}})
 c.bindTranslation('s','Do not read other files')
 assert.equal(c.bindSubmitted('s','po06-intercept-m','real-m',2),true)
 assert.equal(c.observe({id:'s'},{type:'user/message',seq:2,data:{id:'real-m',source:{kind:'user'},content:[{type:'text',text:'Do not read other files'}]}}),'same-input')
 assert.equal(c.taskContext({id:'s'}).inputs.length,1)
 assert.equal(c.taskContext({id:'s'}).inputs[0].id,'real-m')
 assert.equal(c.taskContext({id:'s'}).inputs[0].text,'不要读取其它文件')
 assert.match(c.render('s','','','en'),/Current task understanding/)
})
test('English toggle is independent and adds no response-language forcing',()=>{
 assert.equal(normalizeSettings({}).settings.englishMode,false)
 assert.equal(effectiveSettings({assist:'off',bySession:{A:{englishMode:true}}},'A').englishMode,true)
 assert.equal(effectiveSettings({bySession:{A:{englishMode:true}}},'B').englishMode,false)
 for(const prompt of [EN_INTERPRETER,EN_CAPABILITY,EN_SELECT,EN_FEEDBACK])assert.ok(!/[\u3400-\u9fff]/.test(prompt))
 assert.ok(!/always (reply|respond).*English/i.test(EN_INTERPRETER))
})
test('Chinese UI offers English toggle and selects translated outgoing task only when enabled',()=>{
 const registrations=[],slots=[];const win={__ModuleLoader__:{load:r=>registrations.push(r)}}
 const react={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'F',useState:v=>[typeof v==='function'?v():v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{},useMemo:f=>f(),useCallback:f=>f}
 const require=name=>name==='react'?react:{}
 new Function('window','require',readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'))(win,require)
 const client=registrations[0].factory(require),dispose=client.apply({slots:{register:(o,c)=>{slots.push({o,c});return()=>{}},inject:(_s,cb)=>cb()},locale:'zh'})
 const saved=[],tree=client.__debug.EnglishControls({settings:{englishMode:false},save:p=>saved.push(p),ready:true})
 const slot=nodes(tree).find(n=>n.props&&n.props.name==='english-mode')
 assert.ok(slot,'英文模式必须是与权限同款的两档控件')
 assert.deepEqual(slot.props.options,['off','on'],'两档：关闭 / 开启')
 assert.equal(slot.props.value,'off','默认关闭')
 const seg=nodes(client.__debug.Segmented({...slot.props,failTick:0})).find(n=>n.props['data-po06']==='english-mode')
 assert.ok(seg,'分段控件必须带可核对的标记')
 seg.props.onKeyDown({key:'End',preventDefault(){}})
 assert.deepEqual(saved,[{englishMode:true}])
 assert.equal(client.__debug.outgoingUserText({text:'原话',outgoingText:'English task',englishMode:true}),'English task')
 assert.equal(client.__debug.outgoingUserText({text:'原话',outgoingText:'English task',englishMode:false}),'原话')
 assert.equal(slots.filter(s=>s.o.name==='conversation.input.left').length,1)
 dispose()
})

test('expanded translated excerpt absent from the actual task cannot acquire authority',()=>{
 const p=parseInterpreterOutput(JSON.stringify({ops:[{op:'add_item',item:{id:'req-1',kind:'user_requirement',quote:'改成蓝色',text:'Change to blue',englishQuote:'Change to blue and deploy to production',sourceRefs:[{kind:'human',sessionId:'s',messageId:'m'}]}}]}),{userText:'改成蓝色',translatedText:'Change to blue',englishMode:true,sessionId:'s',messageId:'m',baseRevision:0,baseInputRevision:0})
 assert.equal(p.patch.ops[0].item.text,'改成蓝色')
 assert.equal(p.patch.ops[0].item.englishText,undefined)
})

test('literal JSON and exact requested reply remain untouched; disabling invalidates in-flight translation',()=>{
 const p=protectEnglishLiterals('只回复“完成”，数据为 {"name":"中文","x":3}')
 const restored=restoreEnglishTranslation(p,'Reply only '+p.literals.map(l=>l.token).join(' and '))
 assert.ok(restored.text.includes('完成'));assert.ok(restored.text.includes('{"name":"中文","x":3}'))
 const c=createEnglishMode(),token=c.begin('A','m','原话');c.settingsChanged(()=>false)
 assert.throws(()=>c.record(token,'original text'),/superseded/)
})

test('greeting Hello survives original Chinese in focus without inventing a task or reply language',()=>{
 const original='你好'
 const response={englishTask:'Hello',ops:[{op:'add_item',item:{id:'req-hi',kind:'user_requirement',text:'Greeting',quote:original,englishQuote:'Hello',sourceRefs:[{kind:'human',sessionId:'s',messageId:'m'}]}}],understanding:{summary:'The user has only said hello.',relation:'new',action:'acknowledge',focus:'the bare greeting "你好" and the still-unstated task'},support:{mode:'clarify',nextAction:'Greet back briefly in Chinese and ask which file to edit.'}}
 const ready=prepareEnglishInterpretation(response,original)
 assert.equal(ready.translation.text,'Hello');assert.equal(response.understanding.focus,'the bare greeting "你好" and the still-unstated task')
 assert.equal(ready.value.understanding.focus,'the bare greeting "Hello" and the still-unstated task')
 assert.deepEqual(ready.value.ops,[]);assert.deepEqual(ready.value.support,{mode:'none'})
 const parsed=parseInterpreterOutput(JSON.stringify(ready.value),{userText:original,translatedText:ready.translation.text,englishMode:true,sessionId:'s',messageId:'m',baseRevision:0,baseInputRevision:0})
 assert.equal(parsed.ok,true);assert.equal(parsed.patch,null);assert.equal(parsed.understanding.action,'acknowledge')
})
test('untranslated optional advice is omitted while valid user task and source quotes survive',()=>{
 const value={englishTask:'Build one HTML file',ops:[{op:'add_item',item:{id:'req-html',kind:'user_requirement',quote:'制作一个HTML文件',text:'Build one HTML file',englishQuote:'Build one HTML file'}}],understanding:{summary:'Build a page',action:'execute',focus:'这项任务'},support:{mode:'develop',reason:'Provide a usable file',contribution:'更精细的内部说明'},hardNote:'保持精细'}
 const result=prepareEnglishInterpretation(value,'制作一个HTML文件')
 assert.equal(result.translation.text,'Build one HTML file');assert.equal(result.value.ops[0].item.quote,'制作一个HTML文件')
 assert.equal(result.value.support.contribution,'');assert.equal(result.value.understanding.focus,'')
 assert.ok(result.warnings.some(w=>w.reason==='untranslated-optional-assistance-omitted'))
})
test('valid translated task completes even when optional assistance is absent, without another translation',async()=>{
 const service=createEnglishMode(),token=service.begin('s','m','你好');let calls=0
 const out=await finishEnglishInput({service,token,enabled:()=>true,produced:{outcome:'understood',englishTranslation:{text:'Hello'}},translate:async()=>{calls++;throw new Error('not needed')}})
 assert.equal(out.ok,true);assert.equal(out.translation.text,'Hello');assert.equal(calls,0)
})
test('failed interpretation translates the original once and retains the actual failure reason',async()=>{
 const service=createEnglishMode(),token=service.begin('s','m','你好');let calls=0
 const out=await finishEnglishInput({service,token,enabled:()=>true,produced:{outcome:'interpret-threw',trace:[{step:'interpret',ok:false,error:'malformed-optional-output'}]},translate:async()=>{calls++;return {text:'Hello'}}})
 assert.equal(calls,1);assert.equal(out.ok,true);assert.equal(out.fallback,true)
 assert.equal(out.translation.assistanceReason,'malformed-optional-output')
 const broken=await finishEnglishInput({service,token,enabled:()=>true,produced:null,translate:async()=>{throw new Error('english-translation-incomplete')}})
 assert.equal(broken.ok,false);assert.equal(broken.reason,'english-translation-incomplete')
})
test('superseded cancelled and disabled inputs never launch fallback translation',async()=>{
 const service=createEnglishMode(),token=service.begin('s','m','你好');let calls=0
 const opts={service,token,enabled:()=>true,produced:null,translate:async()=>{calls++;return {text:'Hello'}}}
 const disabled=await finishEnglishInput({...opts,enabled:()=>false});assert.equal(disabled.reason,'english-mode-disabled')
 const ac=new AbortController();ac.abort();assert.equal((await finishEnglishInput({...opts,signal:ac.signal})).reason,'aborted')
 assert.equal((await finishEnglishInput({...opts,produced:{outcome:'superseded-input'}})).reason,'english-input-superseded')
 service.begin('s','new','下一条');assert.equal((await finishEnglishInput(opts)).reason,'english-input-superseded')
 assert.equal(calls,0)
})
test('a fallback translation finishing after newer input is rejected',async()=>{
 const service=createEnglishMode(),token=service.begin('s','m','你好');let resolve
 const result=finishEnglishInput({service,token,enabled:()=>true,produced:null,translate:()=>new Promise(r=>{resolve=r})})
 service.begin('s','new','新输入');resolve({text:'Hello'})
 const out=await result;assert.equal(out.ok,false);assert.equal(out.reason,'english-input-superseded')
})

test('slash commands stay literal and allowlisted commands remain interceptable in English mode',()=>{
 const prepared=protectEnglishLiterals('/vmake 做一辆坦克')
 assert.ok(prepared.literals.some(l=>l.value==='/vmake'),'命令名必须按字面量保护')
 const english='Make a tank. '+prepared.literals.map(l=>l.token).join(' ')
 const restored=restoreEnglishTranslation(prepared,english)
 assert.ok(restored.text.includes('/vmake'),'恢复后命令名与参数原样')
 const source=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8')
 // 2026-10-18 用户指定：实验性功能（快速增强）入口已从界面移除，这条分界断言作废。
 assert.ok(!source.includes("'data-po06': 'experimental-divider'"),'实验性分界不再渲染')
 assert.match(source,/无法确定它能否稳定提升模型能力/,'必须写清能力提升不确定')
 assert.match(source,/增加调用与等待时间/,'快速开关仍须写清额外调用与等待代价')
 assert.ok(source.includes('reasoningOn?h(InferenceMonitor'),'推理过程入口必须跟随推理增强开关')
 assert.ok(source.includes("if (t.startsWith('/') && !slashAllowedDraft(t)) return 'slash-command'"),'英文模式不得整体放行斜杠命令')
 assert.ok(!/englishOn\s*&&\s*draftNow\(\)\.startsWith\('\/'\)/.test(source),'不得因英文模式跳过允许列表命令')
})
// ── GitHub #33 B 段：翻译容错 / 有界重试 / attempts 台账 / 后处理降级 ─────────────────────
const fence=String.fromCharCode(96).repeat(3)
const streamOf=(...events)=>(async function*(){for(const e of events)yield e})()
const textThenFinish=(text,kind='stop')=>streamOf({type:'text-delta',text},{type:'block-end',block:{type:'text',text}},{type:'finish',reason:{kind}})
const failureOf=async run=>{try{await run()}catch(e){return e}throw new Error('expected the operation to fail')}

test('translation JSON tolerates fences, prose and trailing junk but never unwraps an array',()=>{
 const ok={translation:'Hello'}
 assert.deepEqual(extractTranslationJson(fence+'json\n{"translation":"Hello"}\n'+fence),ok)
 assert.deepEqual(extractTranslationJson('Sure, here it is:\n{"translation":"Hello"}\nHope this helps.'),ok)
 assert.deepEqual(extractTranslationJson('{"translation":"Hello"}{"translation":"second"}'),ok,'首个完整对象之后的垃圾要容忍，且不得挑后面的')
 assert.deepEqual(extractTranslationJson('{"translation":"Hello"}}'),ok)
 assert.deepEqual(extractTranslationJson('{"translation":"Hello"} } trailing'),ok)
 assert.equal(extractTranslationJson(fence+'json\n[{"translation":"wrong"}]\n'+fence),null,'顶层数组不是翻译结果')
 assert.equal(extractTranslationJson('[{"translation":"wrong"}]'),null)
 assert.equal(extractTranslationJson(fence+'\n[{"translation":"wrong"}]\n'+fence),null)
 assert.equal(extractTranslationJson('no json at all'),null)
 assert.equal(extractTranslationJson(''),null)
 assert.equal(extractTranslationJson(null),null)
 // 字符串内部的花括号与转义引号不参与配平
 const tricky=JSON.stringify({translation:'He said "use {braces} and \\ backslash" now'})
 assert.deepEqual(extractTranslationJson(tricky),JSON.parse(tricky))
 assert.deepEqual(extractTranslationJson('prefix '+tricky+' ... suffix'),JSON.parse(tricky))
 // 对象内部的数组是正常内容，不因此被拒
 const nested=JSON.stringify({translations:{'ops[0].text':'Keep [a] and {b}'}})
 assert.deepEqual(extractTranslationJson(nested),JSON.parse(nested))
})

test('the balanced scan is bounded and never selects an object beyond the budget',()=>{
 const junk='{"junk"'.repeat(40)
 const started=Date.now()
 assert.equal(extractTranslationJson(junk+'{"translation":"ok"}'),null,'候选越界必须返回 null，而不是挑一个越界的对象')
 assert.equal(extractTranslationJson('{'.repeat(100000)),null)
 assert.ok(Date.now()-started<5000,'病态输入必须有界（不能退化成 O(n²) 重扫）')
 assert.deepEqual(extractTranslationJson('{"translation":"in-budget"}'),{translation:'in-budget'})
})

test('an error-kind finish is retried and only the retry result is used and cached',async()=>{
 const source='不要读取其它文件。制作单HTML文件，保存到 @"D:/项目/结果.html"。'
 const prepared=protectEnglishLiterals(source)
 const english='Do not read other files. Create one HTML file; keep '+prepared.literals.map(l=>l.token).join(' ')
 const expected=prepared.literals.reduce((s,l)=>s.split(l.token).join(l.value),english)
 let calls=0;const seen=[]
 const llm={stream:options=>{calls++;seen.push(options);return calls===1
  ?textThenFinish('{"translation":"WRONG FIRST ATTEMPT"}','error')
  :textThenFinish(JSON.stringify({translation:english}))}}
 const service=createEnglishMode()
 const result=await service.translate(source,{llm,cfg})
 assert.equal(calls,2,'第一轮以 finish error 结束 ⇒ 必须重试')
 assert.equal(result.text,expected,'必须用**重试那轮**的结果（且字面量已原样恢复）')
 assert.ok(!result.text.includes('WRONG FIRST ATTEMPT'))
 for(const literal of prepared.literals)assert.ok(result.text.includes(literal.value),'字面量必须原样恢复')
 assert.equal(result.attempts.length,2)
 assert.equal(result.attempts[0].ok,false);assert.equal(result.attempts[0].finish,'error')
 assert.equal(result.attempts[1].ok,true)
 for(const options of seen){assert.deepEqual(options.tools,[]);assert.equal(options.maxTokens,undefined)}
 assert.equal(seen[0].system,seen[1].system,'重试不得偷换系统提示（不许新增输出语言要求）')
 assert.equal(seen[0].messages[0].content[0].text,seen[1].messages[0].content[0].text,'重试必须发同一份保真载荷')
 const again=await service.translate(source,{llm,cfg})
 assert.equal(again.cached,true,'只有成功那轮能进缓存');assert.equal(again.text,expected);assert.equal(calls,2)
 assert.equal((await service.translate('Reply in Chinese.',{llm,cfg})).text,'Reply in Chinese.')
 assert.equal(calls,2,'原生英文不该多打一次模型')
})

test('unjparseable translation JSON is retried to the bound then fails loudly with attempts',async()=>{
 let calls=0
 const llm={stream:()=>{calls++;return textThenFinish('I cannot translate that.')}}
 const error=await failureOf(()=>createEnglishMode().translate('你好，请制作一个文件。',{llm,cfg}))
 assert.equal(calls,ENGLISH_TRANSLATE_MAX_ATTEMPTS,'重试次数必须封顶')
 assert.equal(error.message,'english-translation-invalid-json')
 assert.equal(error.attempts.length,ENGLISH_TRANSLATE_MAX_ATTEMPTS)
 assert.ok(error.attempts.every(a=>a.ok===false&&a.stage==='json'&&a.retryable===true))
})

test('permanent upstream failures and an aborted caller are never retried',async()=>{
 const source='你好，请制作一个文件。'
 let deniedCalls=0
 const deniedThrow={stream:()=>{deniedCalls++;throw Object.assign(new Error('quota exhausted for this account'),{status:403})}}
 const denied=await failureOf(()=>createEnglishMode().translate(source,{llm:deniedThrow,cfg}))
 assert.equal(deniedCalls,1,'401/403/配额类永久错误只打一次')
 assert.equal(denied.attempts.length,1);assert.equal(denied.attempts[0].status,403);assert.equal(denied.attempts[0].retryable,false)
 let quotaCalls=0
 const quotaFinish={stream:()=>{quotaCalls++;return streamOf({type:'finish',reason:{kind:'error',failure:{code:'HTTP 401 unauthorized: invalid api key'}}})}}
 const deniedFinish=await failureOf(()=>createEnglishMode().translate(source,{llm:quotaFinish,cfg}))
 assert.equal(quotaCalls,1,'finish.reason 里的永久错误同样不重试')
 assert.equal(deniedFinish.attempts.length,1)
 let jitterCalls=0
 const jitter={stream:()=>{jitterCalls++;throw Object.assign(new Error('503 no_healthy_account'),{status:503})}}
 const transient=await failureOf(()=>createEnglishMode().translate(source,{llm:jitter,cfg}))
 assert.equal(jitterCalls,ENGLISH_TRANSLATE_MAX_ATTEMPTS,'503 类抖动必须重试到上界')
 assert.ok(transient.attempts.every(a=>a.retryable===true))
 assert.equal(transient.message,'503 no_healthy_account')
 const pre=new AbortController();pre.abort();let preCalls=0
 const never={stream:()=>{preCalls++;throw new Error('must not be called')}}
 const aborted=await failureOf(()=>createEnglishMode().translate(source,{llm:never,cfg,signal:pre.signal}))
 assert.equal(preCalls,0);assert.equal(aborted.message,'english-aborted');assert.deepEqual(aborted.attempts,[])
 const mid=new AbortController();let midCalls=0
 const cancelling={stream:async function*(){midCalls++;yield {type:'text-delta',text:'partial'};mid.abort();yield {type:'finish',reason:{kind:'error'}}}}
 const cancelled=await failureOf(()=>createEnglishMode().translate(source,{llm:cancelling,cfg,signal:mid.signal}))
 assert.equal(midCalls,1,'调用方取消后不得再开一轮')
 assert.equal(cancelled.message,'english-aborted')
 assert.equal(cancelled.attempts.length,1);assert.equal(cancelled.attempts[0].retryable,false)
})

test('every translation failure path exposes an attempts ledger',async()=>{
 const source='你好，请制作一个文件。'
 const cases=[
  ['error-kind finish',{stream:()=>streamOf({type:'finish',reason:{kind:'error'}})},'english-translation-incomplete'],
  ['finish missing entirely',{stream:()=>streamOf({type:'text-delta',text:'{"translation":"x"}'})},'english-translation-incomplete'],
  ['unjparseable JSON',{stream:()=>textThenFinish('no json here')},'english-translation-invalid-json'],
  ['empty translation',{stream:()=>textThenFinish('{"translation":"  "}')},'english-translation-empty'],
 ]
 for(const [label,llmApi,message] of cases){
  const error=await failureOf(()=>createEnglishMode().translate(source,{llm:llmApi,cfg}))
  assert.equal(error.message,message,label)
  assert.ok(Array.isArray(error.attempts),label+' 必须带 attempts')
  assert.equal(error.attempts.length,ENGLISH_TRANSLATE_MAX_ATTEMPTS,label)
 }
 const mismatch=()=>textThenFinish('{"translations":{}}')
 const assist=await failureOf(()=>createEnglishMode().translateInterpretation({englishTask:'你好',understanding:{summary:'中文概要',action:'execute'}},'你好，制作文件。',{llm:{stream:mismatch},cfg}))
 assert.equal(assist.message,'english-assistance-field-mismatch')
 assert.ok(Array.isArray(assist.attempts)&&assist.attempts.length===ENGLISH_TRANSLATE_MAX_ATTEMPTS)
 const earlyAbort=new AbortController();earlyAbort.abort()
 const abortedAssist=await failureOf(()=>createEnglishMode().translateInterpretation({understanding:{summary:'中文概要'}},'你好',{llm:{stream:mismatch},cfg,signal:earlyAbort.signal}))
 assert.equal(abortedAssist.message,'english-aborted')
 assert.deepEqual(abortedAssist.attempts,[],'还没发起调用时 attempts 是空数组，而不是 undefined')
 const prose=await failureOf(()=>createEnglishMode().translateProse([1],{llm:{stream:mismatch},cfg}))
 assert.equal(prose.message,'english-prose-invalid-input')
 assert.deepEqual(prose.attempts,[])
 const proseInner=await failureOf(()=>createEnglishMode().translateProse(['第一段中文','第二段中文'],{llm:{stream:mismatch},cfg}))
 assert.equal(proseInner.message,'english-assistance-field-mismatch')
 assert.equal(proseInner.attempts.length,ENGLISH_TRANSLATE_MAX_ATTEMPTS,'包装层重抛不许丢台账')
})

test('failed English post-processing degrades to the raw model output with a disclosed warning',async()=>{
 const original='把结果保存到 @"D:/项目/结果.html"'
 const raw={englishTask:'',ops:[{op:'add_item',item:{id:'r1',kind:'user_requirement',quote:'把结果保存到',text:'模型给的原始正文',sourceRefs:[]}}],understanding:{summary:'模型给的原始概要',relation:'new',action:'execute',focus:'原始焦点'},support:{mode:'develop',reason:'原始理由',contribution:'原始贡献'}}
 const snapshot=JSON.parse(JSON.stringify(raw))
 let repairCalls=0
 const service={translateInterpretation:async()=>{repairCalls++;throw new Error('english-translation-incomplete')}}
 const result=await resolveEnglishInterpretation({value:raw,originalText:original,service})
 assert.equal(result.translation,null)
 assert.equal(result.postProcessed,false)
 assert.equal(repairCalls,1,'先尝试修复，修复不了才降级')
 assert.equal(result.repair.ok,false)
 assert.ok(result.warnings.some(w=>w.reason==='english-postprocess-skipped'),'降级必须如实记录')
 assert.deepEqual(result.value,snapshot,'必须退回**未经后处理**的模型输出')
 assert.deepEqual(raw,snapshot,'后处理不得改动解释层已经产出的对象')
 let called=0
 const broken=await resolveEnglishInterpretation({value:undefined,originalText:'你好',service:{translateInterpretation:async()=>{called++;return {}}}})
 assert.equal(called,0)
 assert.equal(broken.translation,null)
 assert.ok(broken.warnings.some(w=>w.reason==='english-postprocess-skipped'))
 const good={englishTask:'Hello',understanding:{summary:'The user has only said hello.',action:'acknowledge'},ops:[],support:{mode:'none'}}
 const kept=await resolveEnglishInterpretation({value:good,originalText:'你好',service:{translateInterpretation:async()=>{throw new Error('must not be called')}}})
 assert.equal(kept.translation.text,'Hello');assert.equal(kept.postProcessed,true)
 assert.ok(!kept.warnings.some(w=>w.reason==='english-postprocess-skipped'))
})

test('a failed fallback translation keeps its attempts ledger for the caller',async()=>{
 const service=createEnglishMode(),token=service.begin('s','m','你好')
 const error=Object.assign(new Error('english-translation-incomplete'),{attempts:[{attempt:1,ok:false},{attempt:2,ok:false}]})
 const out=await finishEnglishInput({service,token,enabled:()=>true,produced:null,translate:async()=>{throw error}})
 assert.equal(out.ok,false);assert.equal(out.reason,'english-translation-incomplete')
 assert.ok(Array.isArray(out.attempts),'调用方要靠它写 englishAttempts 台账')
 assert.equal(out.attempts.length,2)
 const llm={stream:()=>streamOf({type:'finish',reason:{kind:'error'}})}
 const real=await finishEnglishInput({service,token,enabled:()=>true,produced:null,translate:()=>service.translate('你好，制作文件。',{llm,cfg})})
 assert.equal(real.ok,false);assert.equal(real.reason,'english-translation-incomplete')
 assert.equal(real.attempts.length,ENGLISH_TRANSLATE_MAX_ATTEMPTS)
})

test('a fence inside a top-level array cannot smuggle its object out',()=>{
 assert.equal(extractTranslationJson('["'+fence+'json",{"translation":"WRONG"},"'+fence+'"]'),null,'顶层数组里的围栏同样不是翻译结果')
 assert.equal(extractTranslationJson('['+fence+'json\n{"translation":"WRONG"}\n'+fence+']'),null)
 assert.deepEqual(extractTranslationJson('prose '+fence+'json\n{"translation":"ok"}\n'+fence+' tail'),{translation:'ok'})
})

test('quota signals win over a generic 429 or "try again" wording',async()=>{
 const source='你好，请制作一个文件。'
 let quotaCalls=0
 const quota429={stream:()=>{quotaCalls++;throw Object.assign(new Error('insufficient_quota'),{status:429})}}
 const quota=await failureOf(()=>createEnglishMode().translate(source,{llm:quota429,cfg}))
 assert.equal(quotaCalls,1,'insufficient_quota 即使带 429 也只打一次')
 assert.equal(quota.attempts.length,1);assert.equal(quota.attempts[0].retryable,false)
 let forbiddenCalls=0
 const forbidden={stream:()=>{forbiddenCalls++;throw Object.assign(new Error('quota exhausted; try again later'),{status:403})}}
 const denied=await failureOf(()=>createEnglishMode().translate(source,{llm:forbidden,cfg}))
 assert.equal(forbiddenCalls,1,'403 加 try again 也只打一次')
 assert.equal(denied.attempts[0].retryable,false)
 let jitterCalls=0
 const jitter={stream:()=>{jitterCalls++;throw Object.assign(new Error('no_healthy_account quota pool empty'),{status:503})}}
 await failureOf(()=>createEnglishMode().translate(source,{llm:jitter,cfg}))
 assert.equal(jitterCalls,ENGLISH_TRANSLATE_MAX_ATTEMPTS,'issue #33 点名的抖动码仍必须重试')
})

test('a pre-flight config failure still exposes attempts instead of a bare TypeError',async()=>{
 const error=await failureOf(()=>createEnglishMode().translate('你好',{llm:{}}))
 assert.equal(error.message,'english-model-route-unavailable')
 assert.deepEqual(error.attempts,[])
 const assist=await failureOf(()=>createEnglishMode().translateInterpretation({englishTask:'你好'},'你好',{llm:{}}))
 assert.equal(assist.message,'english-model-route-unavailable')
 assert.deepEqual(assist.attempts,[])
})







test('all-invalid optimizer advice fails before English processing can erase its malformed shape',async()=>{
 const raw={intent:{text:'A valid intent',relation:'continue'},add:[17,{bogus:1}]};let calls=0
 const result=await resolveEnglishInterpretation({value:raw,originalText:'A valid intent',service:{translateInterpretation:async()=>{calls++;throw new Error('not needed')}}})
 assert.equal(result.ok,false);assert.equal(result.status,'failed');assert.equal(result.code,'BAD_OPTIMIZER_SHAPE')
 assert.equal(result.dropped.length,2);assert.equal(result.warnings.length,2);assert.deepEqual(result.sourceValue,raw)
 assert.equal(result.postProcessed,false);assert.equal(result.repair,null);assert.equal(calls,0)
})

test('structured optimizer advice normalizes before English processing and keeps source IDs',()=>{
 const original='Create a result.'
 const raw={intent:{text:original,relation:'new'},add:[{id:'a1',text:'Keep comparable feedback.'}],scaffold:[{id:'s1',text:'保留有价值的局部反馈。'}],ask:[{id:'q1',question:'Which setting?'}],hardNote:'贴题的加码。',hardOn:['a1']}
 const before=structuredClone(raw),result=prepareEnglishInterpretation(raw,original)
 assert.deepEqual(result.value.add,['Keep comparable feedback.'])
 assert.deepEqual(result.value.scaffold,['保留有价值的局部反馈。'])
 assert.deepEqual(result.value.ask,['Which setting?'])
 assert.deepEqual(result.value.sourceIds,{add:['a1'],scaffold:['s1'],ask:['q1']})
 assert.deepEqual(result.value.hardOn,['a1']);assert.equal(result.value.hardNote,raw.hardNote)
 assert.ok(result.warnings.some(w=>w.reason==='untranslated-optional-assistance-preserved'))
 assert.deepEqual(raw,before)
})

test('failed optional English repair preserves valid task, useful advice and attempt evidence',async()=>{
 const raw={intent:{text:'Build an object.',relation:'continue'},add:[{id:'a1',text:'仍然有用的制作方向。'}],scaffold:[{id:'s1',text:'仍然有用的反馈方向。'}],ask:[{id:'q1',question:'Which setting?'}]}
 const before=structuredClone(raw);let calls=0
 const attempts=[{attempt:1,ok:false,reason:'unavailable'}]
 const service={translateInterpretation:async value=>{
  calls++;assert.deepEqual(value.add,['仍然有用的制作方向。']);assert.deepEqual(value.sourceIds.add,['a1'])
  throw Object.assign(new Error('english-translation-incomplete'),{attempts})
 }}
 const result=await resolveEnglishInterpretation({value:raw,originalText:'Build an object.',service})
 assert.equal(calls,1);assert.equal(result.translation.text,'Build an object.')
 assert.equal(result.ok,false);assert.equal(result.status,'failed');assert.equal(result.reason,'english-postprocess-failed')
 assert.equal(result.postProcessed,false);assert.ok(result.warnings.some(w=>w.reason==='english-postprocess-failed'))
 assert.deepEqual(result.sourceValue.add,['仍然有用的制作方向。'])
 assert.deepEqual(result.value.add,['仍然有用的制作方向。']);assert.deepEqual(result.value.scaffold,['仍然有用的反馈方向。'])
 assert.deepEqual(result.value.sourceIds,{add:['a1'],scaffold:['s1'],ask:['q1']})
 assert.equal(result.repair.ok,false);assert.deepEqual(result.repair.attempts,attempts);assert.deepEqual(raw,before)
})

test('batch English repair translates every normalized object field once and retains citations',async()=>{
 const raw={intent:{text:'Build an object.',relation:'new'},add:[{id:'a1',text:'制作方向。'}],scaffold:[{id:'s1',text:'反馈方向。'}],ask:[{id:'q1',question:'哪种场景？'}],hardNote:'贴题打气。',hardOn:['a1']}
 const translations={'add[0]':'A coherent result.','scaffold[0]':'Comparable feedback.','ask[0]':'Which setting?','hardNote':'Big energy, same scope.'}
 let calls=0,fields
 const llm={stream:options=>{
  calls++;fields=JSON.parse(options.messages[0].content[0].text).texts.map(row=>row.id)
  return textThenFinish(JSON.stringify({translations}))
 }}
 const result=await resolveEnglishInterpretation({value:raw,originalText:'Build an object.',service:createEnglishMode(),llm,cfg})
 assert.equal(result.ok,true);assert.equal(result.status,'ready');assert.equal(result.postProcessed,true)
 assert.equal(calls,1);assert.deepEqual(fields,Object.keys(translations))
 assert.deepEqual(result.value.add,['A coherent result.']);assert.deepEqual(result.value.scaffold,['Comparable feedback.'])
 assert.deepEqual(result.value.ask,['Which setting?']);assert.equal(result.value.hardNote,translations.hardNote)
 assert.deepEqual(result.value.sourceIds,{add:['a1'],scaffold:['s1'],ask:['q1']});assert.deepEqual(result.value.hardOn,['a1'])
})
