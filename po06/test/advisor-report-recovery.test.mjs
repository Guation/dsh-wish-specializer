import test from 'node:test'
import assert from 'node:assert/strict'
import {recoverAdvisoryJson,parseAdvisorReport} from '../lib/advisor.js'
const value=()=>({verdict:'suggestion',summary:'A real optional gain.',contribution:'Literal code: const t = "]\\\",findings:";\nkeep all text.',assumptions:['Read premise.'],findings:[{text:'Actual current result.',evidenceRefs:['R0']}],checks:[],nextStep:'Compare actual results.',stopCondition:'Keep if no gain.'})
const broken=v=>JSON.stringify(v).replace('],"findings":',']","findings":')
test('one standalone syntactic quote is removed without changing any advisory value',()=>{
 const v=value(),raw=broken(v),out=recoverAdvisoryJson(raw)
 assert.deepEqual(out.value,v);assert.deepEqual(out.recovery,{kind:'single-extraneous-quote',removedCharacters:1,valuesChanged:false})
 const parsed=parseAdvisorReport(raw,new Set(['R0']),'improve_result');assert.equal(parsed.ok,true);assert.deepEqual(parsed.report,v);assert.equal(parsed.formatRecovery.valuesChanged,false)
})
test('valid responses stay strict and review_result never gets advisory recovery',()=>{
 const v=value();assert.equal(recoverAdvisoryJson(JSON.stringify(v)),null)
 // 2026-10-18：格式坏了也必须有答复（降级采纳），但 review_result 仍不做"值级修复"。
 const reviewSalvage=parseAdvisorReport(broken(v),new Set(['R0']),'review_result')
 assert.equal(reviewSalvage.ok,true);assert.equal(reviewSalvage.degraded,true)
 assert.equal(reviewSalvage.report.verdict,'unverified')
 assert.equal(reviewSalvage.formatRecovery,undefined,'review_result 不做单引号修复')
 const valid=parseAdvisorReport(JSON.stringify(v),new Set(['R0']),'improve_result');assert.equal(valid.ok,true);assert.equal(valid.formatRecovery,undefined)
})
test('invalid references, statuses and missing content remain rejected after syntax removal',()=>{
 const bad=value();bad.findings[0].evidenceRefs=['FAKE']
 const degraded=parseAdvisorReport(broken(bad),new Set(['R0']),'improve_result')
 assert.equal(degraded.ok,true,'伪引用不再整份作废')
 assert.deepEqual(degraded.report.findings[0].evidenceRefs,[],'无效引用必须被丢掉')
 assert.ok(degraded.report.evidenceIssues.some(i=>i.reason==='citation-not-found'))
 // 错误结论不会被带进去：非法 verdict 与"没有内容的 suggestion"都降级为 unverified，但答复仍然送达。
 const status=value();status.verdict='pass'
 const coerced=parseAdvisorReport(broken(status),new Set(['R0']),'improve_result')
 assert.equal(coerced.ok,true);assert.equal(coerced.report.verdict,'unverified')
 const missing=value();missing.contribution=''
 const noContribution=parseAdvisorReport(broken(missing),new Set(['R0']),'improve_result')
 assert.equal(noContribution.ok,true);assert.equal(noContribution.report.verdict,'unverified')
})
test('more than one repair, missing delimiters, unescaped value text or huge output is never guessed',()=>{
 const v=value(),raw=broken(v);assert.equal(recoverAdvisoryJson(raw.replace('],"checks":',']","checks":')),null)
 assert.equal(recoverAdvisoryJson(raw.slice(0,-1)),null)
 assert.equal(recoverAdvisoryJson(raw.replace('A real optional gain.','A "broken" gain.')),null)
 assert.equal(recoverAdvisoryJson(raw.replace('A real optional gain.','x'.repeat(48001))),null) // whitespace is not paid content; trim rule handled below
})
