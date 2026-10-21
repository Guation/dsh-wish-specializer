import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, resolve, relative, isAbsolute, basename } from 'node:path'
const digest=x=>createHash('sha256').update(String(x)).digest('hex')
const clone=x=>JSON.parse(JSON.stringify(x))
const text=x=>typeof x==='string'?x.trim():''
const workspaceOf=x=>{if(!text(x))return null;const p=resolve(x);return process.platform==='win32'?p.toLowerCase():p}
const inside=(root,p)=>{if(!root||!isAbsolute(p))return false;const rel=relative(root,p);return !rel.startsWith('..')&&!isAbsolute(rel)}
function outputText(value){
  if(typeof value==='string')return value
  if(Array.isArray(value))return value.filter(x=>x?.type==='text').map(x=>x.text||'').join('\n')
  if(value?.stdout?.text!==undefined)return outputText(value.stdout.text)
  if(typeof value?.text==='string')return value.text
  return ''
}
function payloadOf(result){
  if(result&&typeof result==='object'&&!Array.isArray(result))return result
  const raw=outputText(result)
  try{return JSON.parse(raw)}catch{}
  for(const line of raw.split(/\r?\n/)){try{const value=JSON.parse(line.trim());if(value&&typeof value==='object')return value}catch{}}
  return null
}
function reportOf(result){
  const raw=outputText(result)
  for(const line of raw.split(/\r?\n/)){
    const candidate=line.trim();if(!candidate.startsWith('{'))continue
    try{const value=JSON.parse(candidate);if(value?.taskToolbox?.version==='1')return value.taskToolbox}catch{}
  }
  // Native tool results may wrap a process payload in a JSON text block.
  try{const payload=JSON.parse(raw);if(payload?.stdout?.text)return reportOf(payload)}catch{}
  return null
}

/** Minimal durable task index. Tool reports remain self-reported, bound to an observed call. */
export function createTaskToolboxStore({home=null,namespace='default',now=Date.now}={}){
  const root=home?join(home,'po06-toolbox',digest(namespace).slice(0,16)):null
  const states=new Map(),calls=new Map(),jobs=new Map()
  const file=sid=>join(root,digest(sid)+'.json')
  const fresh=sid=>({version:'1',sessionId:sid,epoch:0,input:null,workspace:null,taskId:null,tasks:{},aliases:{},problem:null})
  const get=sid=>{
    sid=String(sid||'');if(!sid)return null;if(states.has(sid))return states.get(sid)
    let state=fresh(sid)
    if(root)try{const raw=JSON.parse(readFileSync(file(sid),'utf8'));if(raw.version==='1'&&raw.sessionId===sid&&raw.tasks&&typeof raw.tasks==='object'&&!Array.isArray(raw.tasks)){
      state={...state,...raw};state.epoch++;if(state.input)state.input.pending=false
      for(const task of Object.values(state.tasks))for(const entry of Object.values(task.entries||{}))entry.currentAvailability='unknown'
    }else state.problem='unsupported-or-invalid-toolbox-index'}catch(error){if(error.code!=='ENOENT')state.problem='toolbox-index-unreadable'}
    states.set(sid,state);return state
  }
  const save=state=>{
    if(!root||!state)return
    try{mkdirSync(root,{recursive:true});const temp=file(state.sessionId)+'.tmp-'+process.pid;writeFileSync(temp,JSON.stringify(state),'utf8');renameSync(temp,file(state.sessionId))}
    catch{state.problem='toolbox-index-write-failed'}
  }
  const newTask=state=>{
    const id='task-'+randomUUID();state.tasks[id]={id,workspace:state.workspace,createdAt:now(),entries:{},results:{}};state.taskId=id;return id
  }
  const idOf=(state,id)=>state.aliases[id]||id
  const current=(state,token)=>!!state&&!!token&&state.sessionId===token.sessionId&&state.epoch===token.epoch&&idOf(state,state.input?.id)===idOf(state,token.inputId)
  const key=(sid,callId)=>JSON.stringify([sid,callId])
  function consume(state,call,result,isError,seq){
    if(call.cancelled)return {ok:false,reason:'cancelled-call'}
    const report=reportOf(result);if(!report)return {ok:false,reason:'no-toolbox-report'}
    const task=state.tasks[call.taskId];if(!task)return {ok:false,reason:'task-unavailable'}
    const entrypoint=text(report.entrypoint),project=text(report.project)
    if(!inside(call.workspace,entrypoint)||!inside(call.workspace,project))return {ok:false,reason:'toolbox-scope-mismatch'}
    if(!text(call.command).replaceAll('\\','/').toLowerCase().includes(basename(entrypoint).toLowerCase()))return {ok:false,reason:'entry-not-in-observed-call'}
    if(!text(report.operation)||!['ok','error'].includes(report.status))return {ok:false,reason:'invalid-toolbox-report'}
    if(task.results[call.callId])return {ok:true,duplicate:true}
    const entryId='entry-'+digest(entrypoint+'|'+project).slice(0,20)
    const entry=task.entries[entryId]||{id:entryId,name:text(report.name)||basename(entrypoint),entrypoint,project,capabilities:[],createdAt:now(),successCount:0,failureCount:0,uses:[],currentAvailability:'unknown'}
    if(Array.isArray(report.capabilities))entry.capabilities=report.capabilities.filter(x=>typeof x==='string')
    const processFailure=/^\[exit code:\s*(-?\d+)\]/m.exec(outputText(result))
    const succeeded=!isError&&report.status==='ok'&&!(processFailure&&Number(processFailure[1])!==0)
    const record={callId:call.callId,taskId:call.taskId,seq:seq??null,toolName:call.name,operation:report.operation,observedAt:now(),
      status:succeeded?'reported-ok':'reported-error',reportedArtifactVersion:text(report.artifactVersion)||null,
      feedbackRefs:(Array.isArray(report.feedbackRefs)?report.feedbackRefs:[]).filter(p=>typeof p==='string'&&inside(call.workspace,p)),
      source:'observed-tool-result; report-fields-self-reported',imageObserved:false,
      ...(text(report.error)?{error:report.error}:{})}
    task.results[call.callId]=record
    entry.lastResult=record;entry.currentAvailability='unknown';entry.successCount+=succeeded?1:0;entry.failureCount+=succeeded?0:1;entry.uses.push(call.callId)
    task.entries[entryId]=entry;save(state)
    return {ok:true,entryId,taskId:call.taskId,currentTask:call.taskId===state.taskId,record:clone(record)}
  }
  const api={
    beginInput({sessionId,inputId,workspace}){
      const state=get(sessionId);if(!state||!text(inputId))return null
      const nextWorkspace=workspaceOf(workspace)
      if(state.input?.id===inputId&&state.workspace===nextWorkspace)return {sessionId:state.sessionId,inputId,epoch:state.epoch,taskId:state.taskId,workspace:state.workspace}
      const previousId=state.input?.id||null
      if(state.workspace!==nextWorkspace||!state.taskId){state.workspace=nextWorkspace;newTask(state)}
      state.epoch++;state.input={id:inputId,previousId,pending:true};save(state)
      return {sessionId:state.sessionId,inputId,epoch:state.epoch,taskId:state.taskId,workspace:state.workspace}
    },
    settleInput(token,{relation='uncertain'}={}){
      const state=get(token?.sessionId);if(!current(state,token))return {ok:false,reason:'superseded-input'}
      if(!state.input.pending)return {ok:true,taskId:state.taskId}
      if(relation==='new'&&state.input.previousId&&state.taskId===token.taskId)newTask(state)
      state.input.pending=false
      for(const call of calls.values())if(call.sessionId===state.sessionId&&call.epoch===token.epoch){
        call.taskId=state.taskId;call.pending=false
        if(call.buffered){const row=call.buffered;delete call.buffered;consume(state,call,row.result,row.isError,row.seq)}
      }
      save(state);return {ok:true,taskId:state.taskId}
    },
    aliasInput({sessionId,fromId,toId}){
      const state=get(sessionId);if(!state||!text(fromId)||!text(toId))return {ok:false,reason:'invalid-alias'}
      if(idOf(state,state.input?.id)!==idOf(state,fromId))return {ok:false,reason:'input-mismatch'}
      state.aliases[fromId]=toId;state.input.id=toId;save(state);return {ok:true,taskId:state.taskId}
    },
    cancelInput(token){
      const state=get(token?.sessionId);if(!current(state,token))return {ok:false,reason:'superseded-input'}
      for(const call of calls.values())if(call.sessionId===state.sessionId&&call.epoch===token.epoch){call.cancelled=true;delete call.buffered}
      state.input.pending=false;state.epoch++;save(state);return {ok:true}
    },
    captureCall({sessionId,callId,name,args,seq}){
      const state=get(sessionId);if(!state?.taskId||!text(callId))return {ok:false,reason:'no-task'}
      let input=args;if(typeof input==='string')try{input=JSON.parse(input)}catch{return {ok:false,reason:'unreadable-call-arguments'}}
      if(name==='job_output'){
        const job=jobs.get(key(sessionId,text(input?.job_id)))
        if(!job)return {ok:false,reason:'unbound-background-job'}
        calls.set(key(sessionId,callId),{sessionId,callId,name,collectsJob:job});return {ok:true,taskId:job.execution.taskId}
      }
      if(!['bash','pwsh'].includes(name))return {ok:false,reason:'not-an-execution-tool'}
      const command=text(input?.command)||text(input?.cmd)
      if(!command)return {ok:false,reason:'execution-command-required'}
      const id=key(sessionId,callId);if(calls.has(id))return {ok:true,duplicate:true}
      calls.set(id,{sessionId,callId,name,command,seq,epoch:state.epoch,workspace:state.workspace,taskId:state.taskId,pending:state.input?.pending===true});return {ok:true,taskId:state.taskId}
    },
    captureResult({sessionId,callId,result,isError=false,seq}){
      const state=get(sessionId);let call=calls.get(key(sessionId,callId))
      if(!state||!call)return {ok:false,reason:'unbound-call'}
      const payload=payloadOf(result)
      if(typeof payload?.exitCode==='number'&&payload.exitCode!==0||payload?.timedOut===true||payload?.aborted===true)isError=true
      if(call.collectsJob){
        const job=call.collectsJob
        if(payload?.job?.id!==job.id)return {ok:false,reason:'background-job-mismatch'}
        job.output+=outputText(payload.text)
        if(['running','stopping'].includes(payload.job.status))return {ok:true,pending:true}
        if(!['completed','failed','killed'].includes(payload.job.status))return {ok:false,reason:'background-job-status-unknown'}
        isError=isError||payload.job.status!=='completed'||/exit code:\s*[1-9]/.test(String(payload.job.detail||''))
        result=job.output;call=job.execution
      }else if(['background','promoted'].includes(payload?.kind)&&text(payload.jobId)){
        jobs.set(key(sessionId,payload.jobId),{id:payload.jobId,execution:call,output:outputText(payload.output)})
        return {ok:true,pending:true,jobId:payload.jobId}
      }
      if(call.pending){
        if(call.epoch!==state.epoch||call.cancelled)return {ok:false,reason:'superseded-input'}
        call.buffered={result,isError,seq};return {ok:true,pending:true}
      }
      return consume(state,call,result,isError,seq)
    },
    status({sessionId,workspace}={}){
      const state=get(sessionId);if(!state)return {version:'1',taskId:null,entries:[]}
      if(workspace!==undefined&&workspaceOf(workspace)!==state.workspace)return {version:'1',taskId:null,entries:[],problem:'workspace-mismatch'}
      const task=state.tasks[state.taskId]
      return {version:'1',taskId:state.taskId,workspace:state.workspace,inputId:state.input?.id||null,pending:state.input?.pending===true,
        entries:clone(Object.values(task?.entries||{})),problem:state.problem,provenance:'Host-bound task/call identity; capability reports are self-reported; current availability must be checked.'}
    },
    cancelPending(sessionId){
      for(const state of states.values()){if(sessionId&&state.sessionId!==sessionId)continue;for(const call of calls.values())if(call.sessionId===state.sessionId&&call.pending){call.cancelled=true;delete call.buffered}if(state.input?.pending){state.input.pending=false;state.epoch++;save(state)}}
    },
    dispose(){states.clear();calls.clear();jobs.clear()},
  }
  return api
}
