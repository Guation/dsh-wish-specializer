import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { composeOptimizerSystem, buildOptimizerUserMessage, parseOptimizerValue, renderOptimizerPacket } from '../../lib/optimizer-protocol.js'
import { createTrialRuntime } from './trial-runtime.mjs'
const outDir=resolve(process.argv[2]||'.po06-tmp/toolbox-natural/judgments');mkdirSync(outDir,{recursive:true})
const rt=await createTrialRuntime({outDir})
const common={version:'1',sessionId:'isolated-judgment',workspace:'trial-workspace',scope:'session',source:'experiment-predefined-tool-access',coverage:'complete',reason:null,observedAt:new Date().toISOString(),tools:[{name:'read_text',description:'Read task files.'},{name:'write_text',description:'Write task files.'},{name:'run_local',description:'Run local Node scripts.'}],taskTools:[],observations:[]}
const cases=[
 {id:'small',task:'已有页面只把提交按钮文字从“提交”改成“保存”，其他样式和交互不变。',context:'Relevant file already located: index.html. The change is a single button text node.',summary:common},
 {id:'reuse',task:'继续调整同一辆 Three.js 概念车：尾翼收窄一点，检查轮组与车身关系，保留单 HTML 离线交付。',context:'Same task and project; the existing task tools were actually used for named-part edits and captures.',summary:{...common,taskTools:[{name:'vehicle-workshop',entrypoint:'tools/workshop.mjs',project:'current-scene',capabilities:['named-part editing','bounds/spacing query','fixed-view capture','standalone HTML export'],lastResult:{callId:'prior-real-call',operation:'capture',status:'reported-ok',reportedArtifactVersion:'v1',source:'host-bound historical trial result; current availability unknown'},currentAvailability:'unknown'}]}},
 {id:'repeated',task:'制作一台 HTML + Three.js 的机械装配展示，之后会多轮调整多个部件的比例、装配间隙和运动关系，画面要精细、交互可信；最后交付可独立打开的单 HTML。',context:'Only general execution and file access are known. No project-specific editing or comparison tool has been observed. Do not assume absent capabilities not listed here.',summary:common},
 {id:'unknown',task:'现有交互工程要反复比较不同布局及状态的效果，请改进整体体验，保留原技术栈。',context:'No project files read yet. Work model permissions are unchanged.',summary:{...common,scope:'unknown',source:'session-agent-query-failed',coverage:'unknown',reason:'tool table lookup failed; no conclusion about missing tools',tools:[]}},
]
const results=[]
for(const c of cases){
 const system=composeOptimizerSystem({language:'zh',tier:'heavy',toolboxMode:'auto'}).text
 const user=buildOptimizerUserMessage({userText:c.task,context:c.context,capabilitySummary:c.summary})
 writeFileSync(join(outDir,c.id+'-request.json'),JSON.stringify({system,user,expectedScope:'preregistered judgment, no tools executed by optimizer'},null,2)+'\n')
 try{
  const r=await rt.complete({system,messages:[rt.user(user)]},{label:c.id})
  writeFileSync(join(outDir,c.id+'-raw.txt'),r.text)
  let value;try{value=JSON.parse(r.text.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''))}catch{const start=r.text.indexOf('{'),end=r.text.lastIndexOf('}');value=JSON.parse(r.text.slice(start,end+1))}
  const parsed=parseOptimizerValue(value,{sessionId:'judgment-'+c.id,messageId:'m1',baseInputRevision:1})
  const row={id:c.id,ok:parsed.ok,reason:parsed.reason||null,toolbox:parsed.optimizer?.toolbox||null,packet:parsed.ok?renderOptimizerPacket(parsed.optimizer,'zh',{userText:c.task}):null,warnings:parsed.warnings,usage:r.record.usage,ms:r.record.ms}
  results.push(row);writeFileSync(join(outDir,'results.json'),JSON.stringify({route:rt.route,results},null,2)+'\n');console.log(JSON.stringify({id:row.id,ok:row.ok,recommendation:row.toolbox?.recommendation||'omitted',reason:row.toolbox?.reason||row.reason,usage:row.usage,ms:row.ms}))
 }catch(error){results.push({id:c.id,ok:false,error:rt.redact(error.message)});writeFileSync(join(outDir,'results.json'),JSON.stringify({route:rt.route,results},null,2)+'\n');console.log(JSON.stringify(results.at(-1)));process.exitCode=1;break}
}
