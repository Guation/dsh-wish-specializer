// Read-only check of the existing GUI. Does not start a server or change settings.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const session=process.argv[2]||'',base=process.env.TOOLBOX_GUI_URL||'http://127.0.0.1:19387',out=resolve(process.argv[3]||'.po06-tmp/toolbox-natural/live')
mkdirSync(out,{recursive:true})
const response=await fetch(base+'/po06/api/status'+(session?'?session='+encodeURIComponent(session):''),{signal:AbortSignal.timeout(15000)})
const value=await response.json(),effective=value.sessionEffective||value.settings||{}
const report={at:new Date().toISOString(),url:base,http:response.status,session:session||null,
 moduleUrl:value.capability?.moduleUrl||null,toolboxMode:effective.toolboxMode||null,
 previewToolboxMode:value.prompt?.effective?.toolboxMode||null,previewRevision:value.prompt?.effective?.revision||null,
 previewIncludesToolbox:value.prompt?.effective?.parts?.some(p=>p.key==='toolbox')||false,
 actualLastRequest:value.prompt?.lastRequest?{inputId:value.prompt.lastRequest.inputId,toolboxMode:value.prompt.lastRequest.toolboxMode||null,hasCapabilitySummary:!!value.prompt.lastRequest.capabilitySummary}:null,
 indexSupported:value.capability?Object.hasOwn(value.capability,'toolbox'):false,
 loaded:response.ok&&['auto','off'].includes(effective.toolboxMode)&&value.capability&&Object.hasOwn(value.capability,'toolbox'),
 note:'Settings preview is not evidence of an actual model request; live index fields prove the new route is loaded, not task completion.'}
writeFileSync(join(out,'status.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.loaded)process.exitCode=2
