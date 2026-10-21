// Frozen post-trial measurement: reads actual model-authored files, never repairs them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const dir=resolve(process.argv[2]),initial=JSON.parse(readFileSync(resolve('.po06-tmp/toolbox-natural/behavior/prepared.json'),'utf8')).initialScene
const hash=value=>createHash('sha256').update(value).digest('hex')
const result={project:dir,files:{},scene:null,measures:null,limitations:['Scene parameters may not represent model-authored alternate HTML; inspect actual output before judging completion.','Box metrics are not visual quality scores; no automated aesthetic winner is declared.']}
for(const file of ['scene.json','artifact.html','final.html','vehicle.mjs','workshop.mjs'])if(existsSync(join(dir,file))){const bytes=readFileSync(join(dir,file));result.files[file]={bytes:bytes.length,sha256:hash(bytes)}}
try{const p=JSON.parse(readFileSync(join(dir,'scene.json'),'utf8'));result.scene=p;result.measures={wheelInnerClearance:p.wheel.track/2-p.wheel.width/2-p.body.width/2,wingOverhang:(p.wing.span-p.body.width)/2,bodyPreserved:JSON.stringify(p.body)===JSON.stringify(initial.body),paint:p.paint,wingHeight:p.wing.height}}catch(error){result.sceneError=error.message}
writeFileSync(join(dir,'frozen-inspection.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
