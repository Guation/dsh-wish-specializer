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
 assert.equal(parseAdvisorReport(broken(v),new Set(['R0']),'review_result').reason,'advisor-invalid-json')
 const valid=parseAdvisorReport(JSON.stringify(v),new Set(['R0']),'improve_result');assert.equal(valid.ok,true);assert.equal(valid.formatRecovery,undefined)
})
test('invalid references, statuses and missing content remain rejected after syntax removal',()=>{
 const bad=value();bad.findings[0].evidenceRefs=['FAKE'];assert.equal(parseAdvisorReport(broken(bad),new Set(['R0']),'improve_result').reason,'advisor-invalid-citation')
 const status=value();status.verdict='pass';assert.equal(parseAdvisorReport(broken(status),new Set(['R0']),'improve_result').ok,false)
 const missing=value();missing.contribution='';assert.equal(parseAdvisorReport(broken(missing),new Set(['R0']),'improve_result').ok,false)
})
test('more than one repair, missing delimiters, unescaped value text or huge output is never guessed',()=>{
 const v=value(),raw=broken(v);assert.equal(recoverAdvisoryJson(raw.replace('],"checks":',']","checks":')),null)
 assert.equal(recoverAdvisoryJson(raw.slice(0,-1)),null)
 assert.equal(recoverAdvisoryJson(raw.replace('A real optional gain.','A "broken" gain.')),null)
 assert.equal(recoverAdvisoryJson(raw.replace('A real optional gain.','x'.repeat(48001))),null) // whitespace is not paid content; trim rule handled below
})
