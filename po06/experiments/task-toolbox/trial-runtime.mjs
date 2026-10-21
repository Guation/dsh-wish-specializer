// Isolated real-SDK runtime for preregistered local experiments. Never prints or stores auth.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
export const TRIAL_ROUTE=Object.freeze({provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'max'})
export async function createTrialRuntime({depsRoot=process.env.TOOLBOX_DSH_DEPS,home=process.env.TOOLBOX_DSH_HOME,outDir}={}){
 if(!depsRoot||!home||!outDir)throw Error('Provide TOOLBOX_DSH_DEPS, TOOLBOX_DSH_HOME and an output directory')
 const pkg=name=>pathToFileURL(join(depsRoot,name,'lib','index.js')).href
 const [{parseCredentialsDocument},ds,llm,{Context},{LocalAttachmentStore}]=await Promise.all([
   import(pkg('dsh-credentials-local')),import(pkg('dsh-llm-deepseek')),import(pkg('dsh-llm')),import(pkg('cordis')),import(pkg('dsh-attachment-local'))])
 const parsed=parseCredentialsDocument(readFileSync(join(home,'.credentials.yaml'),'utf8'),'local-credentials')
 const key=parsed.refs.get('DEEPSEEK_API_KEY')
 if(typeof key!=='string'||!key)throw Error('official-credential-unavailable')
 const redact=value=>String(value).split(key).join('[redacted]')
 const connection=ds.resolveAdapterOptions({}, {get:()=>undefined})
 const imageStore=new LocalAttachmentStore(new Context(),{dshHome:resolve(outDir,'attachments')})
 const adapter=new ds.DeepSeekAdapter({options:()=>connection,resolveAuth:async()=>({headers:{'x-api-key':key}}),resolveUserId:()=> 'po06-task-toolbox-evaluation',
   resolveAttachments:()=>imageStore,resolveImageAccess:(s,ref)=>llm.resolveImageAttachmentAccess(s,p=>p,ref),prepareExtensions:async()=>({fields:{},accept:()=>Promise.resolve()})})
 mkdirSync(outDir,{recursive:true});let serial=0
 const records=[]
 async function complete(options,{label='call',onDelta}={}){
   const id=++serial,start=Date.now(),assembler=new llm.BlockAssembler()
   const record={id,label,route:TRIAL_ROUTE,startedAt:new Date().toISOString(),toolNames:(options.tools||[]).map(x=>x.name),imageCount:options.messages.flatMap(m=>m.content||[]).filter(b=>b.type==='image').length,usage:null,ms:null,rawText:''}
   records.push(record)
   try{
     for await(const chunk of adapter.stream({...TRIAL_ROUTE,...options})){
       assembler.push(chunk)
       if(chunk.type==='text-delta'){record.rawText+=String(chunk.text||chunk.delta||'');if(onDelta)onDelta(chunk.text||chunk.delta||'')}
     }
     record.usage=assembler.usage||null;record.finish=assembler.finish
     const blocks=assembler.blocks();record.toolCalls=blocks.filter(b=>b.type==='tool-call')
     if(['error','aborted','max-tokens'].includes(assembler.finish.kind))throw Error('incomplete-model-response:'+JSON.stringify(assembler.finish))
     const source={...TRIAL_ROUTE,...(assembler.replayState?{replayState:assembler.replayState}:{})};delete source.reasoningEffort
     return {record,blocks,message:llm.createAssistantMessage({content:blocks,source}),text:blocks.filter(b=>b.type==='text').map(b=>b.text).join(''),calls:blocks.filter(b=>b.type==='tool-call')}
   }catch(error){record.error=redact(error?.message||error);throw Error(record.error)}
   finally{
     record.ms=Date.now()-start
     if(!record.usage)record.usage=assembler.usage||null
     writeFileSync(join(outDir,'requests.json'),JSON.stringify({route:TRIAL_ROUTE,records},null,2)+'\n')
   }
 }
 return {complete,records,llm,route:TRIAL_ROUTE,redact,imageStore,connection,
   user:text=>llm.createUserMessage({source:{kind:'user'},content:[{type:'text',text}]}),
   notice:text=>llm.createUserMessage({source:{kind:'plugin:@dsh-external/dsh-wish-specializer',form:'notice',summary:'task toolbox experiment'},content:[{type:'text',text}]}),
   async image(path){const attachment=await imageStore.saveImage({data:readFileSync(path),mediaType:'image/png',name:join(path).split(/[\\/]/).at(-1)});return {type:'image',attachment}},
 }
}
