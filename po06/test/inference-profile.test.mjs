import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {FAST_REASONING_PROFILE,canonicalReasoning,fixedInferencePlan} from '../lib/inference-profile.js'
import {DEFAULT_SETTINGS,normalizeSettings,mergeSettings,writeSettings} from '../lib/settings.js'
import {effectiveSettings,policyFor,readPolicy} from '../lib/policy.js'

const profileOf=value=>Object.fromEntries(Object.keys(FAST_REASONING_PROFILE).map(key=>[key,value[key]]))
const plan={mode:'hybrid',pace:'fast',workflow:'directions-to-worker',requestedCandidates:3,requestedRounds:3,effectiveCandidates:3,effectiveRounds:0,maxCalls:4,maxExtraCalls:3,capReason:'fast-only-profile',profile:'fast-3x3'}

test('shared fast profile is immutable and preserves caller-owned settings',()=>{
 assert.deepEqual(FAST_REASONING_PROFILE,{reasoningMode:'hybrid',reasoningCandidates:3,reasoningRounds:3,reasoningPace:'fast'})
 assert.equal(Object.isFrozen(FAST_REASONING_PROFILE),true)
 const config={reasoningBoost:false,englishMode:true,reasoningMode:'loop',reasoningCandidates:2,reasoningRounds:1,reasoningPace:'inherit',model:{provider:'p',model:'m'},unrelated:{retained:true}}
 const before=structuredClone(config),actual=canonicalReasoning(config)
 assert.deepEqual(actual,{...config,...FAST_REASONING_PROFILE})
 assert.deepEqual(config,before);assert.notEqual(actual,config)
 assert.equal(actual.model,config.model);assert.equal(actual.unrelated,config.unrelated)
 assert.deepEqual(canonicalReasoning(),FAST_REASONING_PROFILE)
 assert.equal(Object.hasOwn(canonicalReasoning({}),'reasoningBoost'),false)
 assert.equal(Object.hasOwn(canonicalReasoning({}),'englishMode'),false)
})

test('fixed 3+3 plan cannot revive serial loops through legacy or invalid selectors',()=>{
 assert.deepEqual(fixedInferencePlan(),plan)
 for(const mode of ['parallel','loop','hybrid','serial',null,{},false])
 for(const pace of ['fast','balanced','inherit','thorough',null,{},false])
 for(const candidates of [undefined,1,2,3,9,-1,2.5,'9',null])
 for(const rounds of [undefined,1,2,3,9,-1,2.5,'9',null]){
  assert.deepEqual(fixedInferencePlan({reasoningMode:mode,reasoningPace:pace,reasoningCandidates:candidates,reasoningRounds:rounds}),plan)
 }
 const changed=fixedInferencePlan();changed.effectiveRounds=99
 assert.deepEqual(fixedInferencePlan(),plan)
})

test('missing global profile fields default to fast 3+3 without enabling boost or reporting problems',()=>{
 const normalized=normalizeSettings({})
 assert.deepEqual(profileOf(DEFAULT_SETTINGS),FAST_REASONING_PROFILE)
 assert.deepEqual(profileOf(normalized.settings),FAST_REASONING_PROFILE)
 assert.equal(normalized.settings.reasoningBoost,false)
 assert.equal(normalized.settings.englishMode,false)
 assert.deepEqual(normalized.problems,[])
 assert.deepEqual(normalizeSettings({...FAST_REASONING_PROFILE}).problems,[])
})

test('legacy global presets migrate visibly while boolean, route, effort, tier and permission settings survive',()=>{
 const raw={tier:'heavy',reasoningBoost:true,englishMode:true,reasoningMode:'loop',reasoningCandidates:2,reasoningRounds:1,reasoningPace:'inherit',model:{provider:'p',model:'m'},effortByModel:{'p/m':'max'},permission:'review',historyMode:'full',turns:4,readTools:true,bash:false,slashReview:['run']}
 const before=structuredClone(raw),{settings,problems}=normalizeSettings(raw)
 assert.deepEqual(profileOf(settings),FAST_REASONING_PROFILE)
 for(const key of ['reasoningBoost','englishMode','model','effortByModel','permission','historyMode','turns','readTools','bash','slashReview'])assert.deepEqual(settings[key],raw[key])
 assert.deepEqual([settings.assist,settings.detail,settings.budget],['auto','detailed','generous'])
 for(const key of Object.keys(FAST_REASONING_PROFILE)){
  const problem=problems.find(p=>p.key===key)
  assert.ok(problem,key+' migration must be reported')
  assert.equal(problem.got,raw[key]);assert.equal(problem.used,FAST_REASONING_PROFILE[key])
 }
 assert.deepEqual(raw,before)
})

test('invalid legacy selectors are safe and visible rather than becoming hidden loop routes',()=>{
 for(const [key,used] of Object.entries(FAST_REASONING_PROFILE))for(const value of [null,{},[],false,'wrong',-1,0,99,2.5]){
  const {settings,problems}=normalizeSettings({[key]:value})
  assert.equal(settings[key],used)
  assert.deepEqual(problems.map(p=>({key:p.key,got:p.got,used:p.used})),[{key,got:value,used}])
 }
 const result=normalizeSettings({reasoningBoost:'true',englishMode:'yes'})
 assert.equal(result.settings.reasoningBoost,false);assert.equal(result.settings.englishMode,false)
 assert.equal(result.problems.length,2)
})

test('session intent stays sparse while explicit selectors are canonical and scoped',()=>{
 const raw={reasoningBoost:true,englishMode:false,bySession:{A:{reasoningBoost:false},B:{tier:'off',englishMode:true},C:{reasoningPace:'inherit',reasoningRounds:1},D:{reasoningMode:null,reasoningCandidates:'9'}}}
 const before=structuredClone(raw),{settings,problems}=normalizeSettings(raw)
 assert.deepEqual(settings.bySession,{A:{reasoningBoost:false},B:{tier:'off',englishMode:true},C:{reasoningPace:'fast',reasoningRounds:3},D:{reasoningMode:'hybrid',reasoningCandidates:3}})
 assert.deepEqual(raw,before)
 assert.equal(problems.length,4)
 for(const problem of problems)assert.notEqual(problem.used,undefined)
 assert.equal(effectiveSettings(settings,'A').reasoningBoost,false)
 assert.equal(effectiveSettings(settings,'B').reasoningBoost,true)
 assert.equal(effectiveSettings(settings,'B').assist,'off')
 assert.equal(effectiveSettings(settings,'B').englishMode,true)
 assert.deepEqual(profileOf(effectiveSettings(settings,'C')),FAST_REASONING_PROFILE)
 assert.deepEqual(normalizeSettings(settings).settings.bySession,settings.bySession)
})

test('merge reports migration during unrelated writes and cannot leak one session toggle into globals',()=>{
 const old={reasoningBoost:false,englishMode:true,reasoningMode:'loop',reasoningPace:'balanced',bySession:{A:{reasoningBoost:false,reasoningRounds:1},B:{tier:'heavy'}}}
 const unrelated=mergeSettings(old,{permission:'review'})
 assert.deepEqual(profileOf(unrelated.settings),FAST_REASONING_PROFILE)
 assert.equal(unrelated.problems.filter(p=>p.key==='reasoningMode').length,1)
 assert.ok(unrelated.problems.some(p=>p.key==='bySession[A].reasoningRounds'&&p.got===1&&p.used===3))
 const toggled=mergeSettings(unrelated.settings,{bySession:{...unrelated.settings.bySession,A:{reasoningBoost:true}}}).settings
 assert.equal(toggled.reasoningBoost,false);assert.equal(toggled.englishMode,true)
 assert.deepEqual(toggled.bySession.A,{reasoningBoost:true});assert.deepEqual(toggled.bySession.B,{tier:'heavy'})
 assert.equal(effectiveSettings(toggled,'A').reasoningBoost,true)
 assert.equal(effectiveSettings(toggled,'B').reasoningBoost,false)
})

test('fixture-only reads are non-mutating and writes canonicalize without changing unrelated configuration',()=>{
 const home=mkdtempSync(join(tmpdir(),'inference-profile-')),path=join(home,'po06.json')
 try{
  const original={settingsVersion:1,enabled:false,rollout:{mode:'off'},assist:'off',reasoningBoost:false,reasoningMode:'loop',reasoningCandidates:2,reasoningRounds:1,reasoningPace:'inherit',englishMode:true,model:{provider:'p',model:'m'},effortByModel:{'p/m':'max'},permission:'review',customOwner:{keep:'unchanged'},bySession:{A:{reasoningBoost:false},B:{reasoningMode:'parallel',tier:'heavy'}}}
  const source=JSON.stringify(original);writeFileSync(path,source)
  const read=readPolicy({home,sessionId:'A'})
  assert.deepEqual(profileOf(read),FAST_REASONING_PROFILE);assert.equal(read.reasoningBoost,false);assert.equal(read.injectPacket,false)
  assert.equal(readFileSync(path,'utf8'),source,'status/policy reads must not migrate the file on disk')
  const written=writeSettings({path,patch:{bySession:{...original.bySession,A:{reasoningBoost:true}}},now:7})
  assert.equal(written.ok,true,JSON.stringify(written))
  const saved=JSON.parse(readFileSync(path,'utf8'))
  assert.deepEqual(profileOf(saved),FAST_REASONING_PROFILE)
  assert.deepEqual(saved.bySession,{A:{reasoningBoost:true},B:{reasoningMode:'hybrid',tier:'heavy'}})
  for(const key of ['enabled','rollout','assist','reasoningBoost','englishMode','model','effortByModel','permission','customOwner'])assert.deepEqual(saved[key],original[key])
  assert.equal(policyFor(saved,'A').reasoningBoost,true)
  assert.equal(policyFor(saved,'A').injectPacket,false,'boost is independent from source prompt assistance being off')
  assert.equal(policyFor(saved,'B').reasoningBoost,false)
  assert.equal(readFileSync(written.backup,'utf8'),source)
 }finally{rmSync(home,{recursive:true,force:true})}
})
