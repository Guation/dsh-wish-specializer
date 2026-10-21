// One real optimizer generation, not a working-model simulation or tool-building experiment.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildInterpreterProtocol } from '../lib/index.js'
import { buildOptimizerUserMessage, renderOptimizerPacket, OPTIMIZER_OUTPUT_BUDGET_TOKENS } from '../lib/optimizer-protocol.js'
import { parseInterpreterOutput } from '../lib/interpreter.js'
const deps=process.env.SCAFFOLD_CHECK_DEPS,home=process.env.SCAFFOLD_CHECK_HOME
if(!deps||!home)throw Error('Set SCAFFOLD_CHECK_DEPS and SCAFFOLD_CHECK_HOME for the existing local SDK and credentials.')
const output=resolve(process.argv[2]||'.po06-tmp/scaffold-directions-smoke')
mkdirSync(output,{recursive:true})
const load=name=>import(pathToFileURL(join(deps,name,'lib','index.js')).href)
const [{parseCredentialsDocument},ds,llm]=await Promise.all([load('dsh-credentials-local'),load('dsh-llm-deepseek'),load('dsh-llm')])
const document=parseCredentialsDocument(readFileSync(join(home,'.credentials.yaml'),'utf8'),'local-credentials')
const key=document.refs.get('DEEPSEEK_API_KEY')
if(!key)throw Error('official credential unavailable')
const adapter=new ds.DeepSeekAdapter({options:()=>ds.resolveAdapterOptions({}, {get:()=>undefined}),resolveAuth:async()=>({headers:{'x-api-key':key}}),resolveUserId:()=> 'wish-scaffold-direction-check',prepareExtensions:async()=>({fields:{},accept:()=>Promise.resolve()})})
const userText='不要预览文件夹内的项目文件,给我制作一个单html程序,可以使用three.js或者是别的你擅长的,内容要求是:一个极其精细的跑车模型,要求极其帅气,精细,所有地方都做到极致,要求可以预览,驾驶。'
const protocol=await buildInterpreterProtocol({home,toolsEnabled:false,strategy:{tier:'heavy'},englishMode:false})
const prompt=buildOptimizerUserMessage({userText,styleHint:'分别返回制作建议 add、临时脚手架建议 scaffold、需要反问的 ask。每条是大概的方向指导，不能给具体步骤、代码、命令、参数、接口或脚手架操作协议。Ask 只列问题，工作模型自己思考选项。三段合计3000 token以内，不要求用满。'})
const route={provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'max'}
const started=Date.now(),assembler=new llm.BlockAssembler(),record={revision:protocol.revision,budgetTokens:OPTIMIZER_OUTPUT_BUDGET_TOKENS,route,originalText:userText,toolsOff:true,raw:'',usage:null,ok:false}
try{
 for await(const chunk of adapter.stream({...route,system:protocol.text,messages:[llm.createUserMessage({source:{kind:'user'},content:[{type:'text',text:prompt}]})]})){
  assembler.push(chunk);if(chunk.type==='text-delta')record.raw+=chunk.text||chunk.delta||''
 }
 record.usage=assembler.usage||null;record.finish=assembler.finish
 const parsed=parseInterpreterOutput(record.raw,{userText,sessionId:'scaffold-check',messageId:'m1',baseRevision:1,baseInputRevision:1,causeId:'scaffold-check'})
 if(!parsed.ok)throw Error(parsed.code+': '+parsed.reason)
 record.optimizer=parsed.optimizer;record.packet=renderOptimizerPacket(parsed.optimizer,'zh',{userText})
 record.counts={production:parsed.optimizer.add?.length||0,scaffold:parsed.optimizer.scaffold?.length||0,ask:parsed.optimizer.ask?.length||0}
 record.ok=assembler.finish.kind==='stop'&&record.counts.scaffold>0
 if(!record.ok)throw Error('Response did not finish or contain model-generated scaffold suggestions.')
 writeFileSync(join(output,'packet.txt'),record.packet+'\n')
}catch(error){record.error=String(error.message).split(key).join('[redacted]');process.exitCode=1}
finally{
 record.ms=Date.now()-started;record.usage=record.usage||assembler.usage||null
 writeFileSync(join(output,'result.json'),JSON.stringify(record,null,2)+'\n')
 console.log(JSON.stringify({ok:record.ok,revision:record.revision,budgetTokens:record.budgetTokens,counts:record.counts,usage:record.usage,ms:record.ms,error:record.error,output},null,2))
}
