// An isolated reusable CLI workshop. This file is not loaded by the plugin runtime.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createVehicle, renderPage } from './vehicle.mjs'
const started=Date.now(),[operation,projectArg,...args]=process.argv.slice(2)
if(!projectArg)throw Error('Usage: toolbox.mjs init|inspect|edit|capture|export <project-dir> [args]')
const project=resolve(projectArg),specPath=join(project,'scene.json')
const option=(name,fallback=null)=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:fallback}
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex')
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n','utf8')
const load=path=>JSON.parse(readFileSync(path,'utf8'))
const version=p=>hash(p).slice(0,16)
const entrypoint=resolve(fileURLToPath(import.meta.url))
const feedbackRefs=[]
let metadata={}
function html(p){
  const core=readFileSync(join(p.threeRoot,'build','three.core.js'),'utf8')
  let module=readFileSync(join(p.threeRoot,'build','three.module.js'),'utf8')
  const coreUrl='data:text/javascript;base64,'+Buffer.from(core).toString('base64')
  module=module.replaceAll("'./three.core.js'",JSON.stringify(coreUrl)).replaceAll('"./three.core.js"',JSON.stringify(coreUrl))
  const moduleUrl='data:text/javascript;base64,'+Buffer.from(module).toString('base64')
  const renderSpec={...p};delete renderSpec.threeRoot
  const safe=JSON.stringify(renderSpec).replaceAll('<','\\u003c')
  return '<!doctype html><html><head><meta charset="utf-8"><title>Task toolbox vehicle</title><style>body{margin:0;background:#111a26;color:#b6c7da;font:12px system-ui;overflow:hidden}canvas{display:block}#label{position:fixed;top:22px;left:24px;letter-spacing:2px}#views{position:fixed;bottom:20px;left:24px;display:flex;gap:8px}button{border:1px solid #435165;background:#172432;color:#dce9f2;border-radius:5px;padding:7px 12px;cursor:pointer}</style></head><body><script type="module">import * as THREE from '+JSON.stringify(moduleUrl)+';const createVehicle='+createVehicle.toString()+';const renderPage='+renderPage.toString()+';renderPage(THREE,createVehicle,'+safe+');</script></body></html>'
}
function build(p){
  const output=join(project,'artifact-'+p.version+'.html');writeFileSync(output,html(p));copyFileSync(output,join(project,'artifact.html'));return output
}
function envelope(status,payload){
  const spec=existsSync(specPath)?load(specPath):null
  return {taskToolbox:{version:'1',name:'Three.js vehicle workshop',entrypoint,operation,project,
    artifactVersion:spec?version(spec):null,subject:'concept-vehicle',status,feedbackRefs,...payload},ms:Date.now()-started}
}
async function inspect(p){
  const loaded=await import(pathToFileURL(join(p.threeRoot,'build','three.cjs')).href),THREE=loaded.default||loaded
  const {root,parts}=createVehicle(THREE,p);root.updateMatrixWorld(true)
  const bounds=Object.fromEntries([...parts].map(([name,mesh])=>{const b=new THREE.Box3().setFromObject(mesh);return [name,{min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new THREE.Vector3()).toArray()}]}))
  return {bounds,measurements:{wheelInnerClearance:p.wheel.track/2-p.wheel.width/2-p.body.width/2,wingOverhang:(bounds.wing.size[2]-bounds.body.size[2])/2},
    limitations:['wheelInnerClearance uses maximum body width, not local arch or precise collision.', 'A bounding box or a ratio is not an aesthetic quality score.']}
}
async function capture(p,label){
  const profile=join(project,'browser-'+Date.now()),edge=option('edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
  mkdirSync(profile,{recursive:true})
  const child=spawn(edge,['--headless','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-gpu','--disable-extensions','--disable-sync','--enable-unsafe-swiftshader','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'inherit'})
  let ws,seq=0;const pending=new Map(),errors=[],requests=[],transport=[]
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;transport.push({sent:id,method,at:Date.now()});const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  try{
    let port
    for(let i=0;i<80&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{}if(!port)await new Promise(r=>setTimeout(r,125))}
    if(!port)throw Error('isolated-browser-start-failed')
    const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
    ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl)
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
    ws.onmessage=event=>{const message=JSON.parse(event.data);transport.push({received:message.id||null,method:message.method||null,error:message.error||null,bytes:String(event.data).length,at:Date.now()});if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(p)message.error?p.reject(Error(message.error.message)):p.resolve(message.result)}
      else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails)
      else if(message.method==='Network.requestWillBeSent'&&/^https?:/.test(message.params.request.url))requests.push(message.params.request.url)}
    await call('Runtime.enable');await call('Page.enable');await call('Network.enable')
    await call('Network.setBlockedURLs',{urls:['http://*','https://*']})
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false})
    await call('Page.navigate',{url:pathToFileURL(join(project,'artifact.html')).href})
    let ready=false
    for(let i=0;i<80;i++){ready=await evaluate('!!window.__toolbox?.ready');if(ready)break;await new Promise(r=>setTimeout(r,100))}
    if(!ready)throw Error('WebGL scene did not become ready; '+JSON.stringify(errors).slice(0,2000))
    const views=(option('views','hero,side,top')).split(',')
    const images=[]
    for(const view of views){await evaluate('window.__toolbox.view('+JSON.stringify(view)+')');const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const file=join(project,label+'-'+view+'.png');writeFileSync(file,Buffer.from(shot.data,'base64'));images.push(file);feedbackRefs.push(file)}
    const runtime=await evaluate('window.__toolbox.rendererInfo()')
    const result={label,sceneVersion:p.version,artifactVersion:version(p),browserPid:child.pid,images,views,viewport:{width:1280,height:800},runtime,exceptions:errors,externalRequests:requests}
    save(join(project,label+'-capture.json'),result);feedbackRefs.push(join(project,label+'-capture.json'))
    if(errors.length)throw Error('browser-runtime-exceptions')
    return result
  }finally{
    if(ws?.readyState===WebSocket.OPEN){await call('Browser.close').catch(()=>{});ws.close()}
    if(child.exitCode===null)child.kill()
    save(join(project,label+'-transport.json'),{browserPid:child.pid,transport})
  }
}
try{
  mkdirSync(project,{recursive:true})
  if(operation==='init'){
    if(existsSync(specPath))throw Error('project-already-initialized')
    const threeRoot=option('three-root');if(!threeRoot)throw Error('--three-root required (reuse local install)')
    const spec={version:'v000',threeRoot:resolve(threeRoot),paint:'#e7edf2',body:{length:4.9,width:2.2},wheel:{base:3.1,track:1.8,width:.32,radius:.47},wing:{span:3.7,height:1.42}}
    save(specPath,spec);mkdirSync(join(project,'history'),{recursive:true});save(join(project,'history',spec.version+'.json'),spec)
    metadata={artifact:build(spec),description:'Named part editing, geometry measurements, fixed views and standalone export.',capabilities:['inspect','edit','capture','export']}
  }else{
    const spec=load(specPath)
    if(operation==='inspect')metadata=await inspect(spec)
    else if(operation==='edit'){
      const [field,input]=args;const steps=String(field).split('.');let owner=spec
      for(const step of steps.slice(0,-1)){if(!Object.hasOwn(owner,step)||typeof owner[step]!=='object')throw Error('unknown-field');owner=owner[step]}
      const key=steps.at(-1);if(!Object.hasOwn(owner,key)||field==='threeRoot'||field==='version')throw Error('unsupported-edit')
      const value=typeof owner[key]==='number'?Number(input):String(input)
      if(typeof value==='number'&&(!Number.isFinite(value)||value<=0))throw Error('positive finite value required')
      const before=version(spec),previous=owner[key];owner[key]=value;spec.version='v'+String(Number(spec.version.slice(1))+1).padStart(3,'0')
      save(specPath,spec);save(join(project,'history',spec.version+'.json'),spec)
      metadata={field,before,previous,value,artifact:build(spec)}
    }else if(operation==='capture')metadata=await capture(spec,args[0]||spec.version)
    else if(operation==='export'){const output=resolve(args[0]||join(project,'final.html'));writeFileSync(output,html(spec));metadata={output,sha256:hash(readFileSync(output)),standalone:true,requiresHTTP:false};feedbackRefs.push(output)}
    else throw Error('unknown-operation')
  }
  const record=envelope('ok',metadata);save(join(project,Date.now()+'-'+operation+'.json'),record);console.log(JSON.stringify(record))
}catch(error){console.log(JSON.stringify(envelope('error',{error:String(error.message)})));process.exitCode=1}
