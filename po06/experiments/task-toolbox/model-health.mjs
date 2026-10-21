import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTrialRuntime } from './trial-runtime.mjs'
const outDir=resolve(process.argv[2]||'.po06-tmp/toolbox-natural/health')
const rt=await createTrialRuntime({outDir})
try{
 const result=await rt.complete({system:'Return only READY to confirm the SDK text channel. Do not invoke tools.',messages:[rt.user('Reply READY.')]},{label:'health-text'})
 const output={ok:result.text.trim()==='READY',text:result.text,finish:result.record.finish,usage:result.record.usage,ms:result.record.ms}
 writeFileSync(resolve(outDir,'result.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));if(!output.ok)process.exitCode=1
}catch(error){console.log(JSON.stringify({ok:false,error:rt.redact(error.message)}));process.exitCode=1}
