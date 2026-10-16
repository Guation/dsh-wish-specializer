import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createInferenceEvidence, INFERENCE_EVIDENCE_VERSION} from '../lib/inference-evidence.js'

const sha = text => createHash('sha256').update(text).digest('hex')
const user = (seq, kind = 'user') => ({seq, type: 'user/message', data: {source: {kind}, content: [{type: 'text', text: 'actual task'}]}})
const call = (seq, callId, name = 'check', args = {}, extra = {}) => ({seq, type: 'tool/call', data: {callId, name, arguments: args, ...extra}})
const result = (seq, callId, content, extra = {}) => ({seq, type: 'tool/result', data: {message: {toolCallId: callId, content: typeof content === 'string' ? [{type: 'text', text: content}] : content}, ...extra}})
const check = (id, status, path = 'a.html', extra = {}) => JSON.stringify({checks: [{id, status, ...extra}], ...(path ? {artifact: {path}} : {})})
function fixture(t, config = {}) {
 const root = mkdtempSync(join(tmpdir(), 'po06-inference-evidence-'))
 t.after(() => rmSync(root, {recursive: true, force: true}))
 writeFileSync(join(root, 'a.html'), 'private file bytes: initial A')
 writeFileSync(join(root, 'b.html'), 'private file bytes: initial B')
 let time = 1000, seq = 0, requestId = null
 const events = [], memory = createInferenceEvidence({now: () => ++time, ...config})
 const session = {id: 'session-A', header: {cwd: root}, snapshotEvents: () => events}
 const emit = (type, data, opts = {}) => {
  const event = {seq: ++seq, type, data}; events.push(event)
  if (type === 'user/message' && data.source.kind === 'user') requestId = 'human:' + seq
  memory.observe(session, event, {readEnabled: true, ...opts}); return event
 }
 const input = (kind = 'user') => emit('user/message', {source: {kind}, content: 'task'})
 const begin = (name = 'check', args = {artifact: {path: 'a.html'}}, opts = {}) => {
  const id = 'call-' + (seq + 1); emit('tool/call', {callId: id, name, arguments: args}, opts); return id
 }
 const end = (id, content, opts = {}, extra = {}) => emit('tool/result', {message: {toolCallId: id, content: [{type: 'text', text: content}]}, ...extra}, opts)
 const run = (content, {name = 'check', args = {artifact: {path: 'a.html'}}, readEnabled = true, extra = {}} = {}) => { const id = begin(name, args, {readEnabled}); return end(id, content, {readEnabled}, extra) }
 const snap = (opts = {}) => memory.snapshot({sessionId: session.id, requestId, root, readEnabled: true, ...opts})
 const set = (path, text) => writeFileSync(join(root, path), text)
 input()
 return {root, memory, session, events, emit, input, begin, end, run, snap, set}
}
function storeFile(home, namespace, sessionId = 'session-A') {
 return join(home, 'po06-inference-evidence', sha(namespace).slice(0, 16), sha(sessionId) + '.json')
}

test('small exported API is observation only and safely ignores unavailable inputs', t => {
 const f = fixture(t)
 assert.equal(INFERENCE_EVIDENCE_VERSION, 1)
 assert.deepEqual(f.memory.observe(null, null), {observed: false})
 assert.doesNotThrow(() => f.memory.observe(f.session, {type: 'tool/result', data: {}}))
 assert.equal(f.memory.status().completionClaimAllowed, false)
 assert.equal(f.snap().mode, 'explore')
 assert.equal(f.snap().completionClaimAllowed, false)
 f.memory.dispose()
 assert.equal(f.memory.status().ready, false)
 assert.deepEqual(f.memory.observe(f.session, user(100)), {observed: false})
})

test('pipe and whole-line FAIL/FAILED/ERROR/Traceback reports have stable source refs', t => {
 const f = fixture(t)
 f.run('TRACE station | FAIL spacing varies | PASS no discontinuity\nFAILED turret-heading\nERROR: fpsTick\nTraceback (most recent call last):')
 const snapshot = f.snap()
 assert.equal(snapshot.mode, 'diagnose')
 assert.equal(snapshot.openIssues.length, 4)
 assert.deepEqual(snapshot.openIssues.map(i => i.label), ['spacing varies', 'turret-heading', 'fpsTick', 'Traceback'])
 assert.ok(snapshot.openIssues.every(i => i.kind === 'reported-failure' && i.id === 'E3' && i.source.tool === 'check'))
 assert.equal(snapshot.openIssues[0].excerpt, ' FAIL spacing varies ')
 assert.equal(snapshot.openIssues[0].binding.sha256, sha('private file bytes: initial A'))
})

test('unrelated PASS, ALL PASS banners and model path exoneration never wash away failures', t => {
 const f = fixture(t)
 f.run('FAIL world-spacing\nPASS closure')
 f.emit('assistant/message', {content: 'path exonerated; ALL PASS'})
 f.emit('assistant/reasoning', {text: 'PASS world-spacing'})
 f.input('plugin:@dsh-external/dsh-arbiter-wf')
 f.run('TEST[all] ALL PASS\nPASS no-discontinuity\nPASS arc-pitch')
 assert.equal(f.snap().openIssues.length, 1)
 assert.equal(f.snap().openIssues[0].label, 'world-spacing')
})

test('quoted and fenced expected-failure examples and lowercase prose are not failure reports', t => {
 const f = fixture(t), fence = String.fromCharCode(96).repeat(3)
 f.run(['this should fail if broken', '> FAIL illustrative output', '"ERROR quoted output"', 'Example: FAILED demo', 'FAIL expected-failure fixture', fence, 'FAIL fenced example', fence, 'PASS measured result'].join('\n'))
 assert.equal(f.snap().openIssues.length, 0)
 f.run('FAIL measured result')
 assert.equal(f.snap().openIssues.length, 1)
})

test('a fresh same-check same-object retest can close a known-version failure', t => {
 const f = fixture(t)
 f.run(check('world-spacing', 'failed'))
 assert.equal(f.snap().openIssues.length, 1)
 f.run(check('world-spacing', 'passed'))
 const snapshot = f.snap()
 assert.equal(snapshot.openIssues.length, 0)
 assert.equal(snapshot.mode, 'explore')
 assert.equal(snapshot.completionClaimAllowed, false)
 assert.equal(snapshot.recentEvidence.at(-1).checks[0].binding.sha256, sha('private file bytes: initial A'))
})

test('a repaired new version requires an actual same-check retest and reopens on later changes', t => {
 const f = fixture(t)
 f.run(check('world-spacing', 'fail'))
 f.set('a.html', 'repaired A')
 assert.equal(f.snap().openIssues[0].status, 'changed-pending')
 f.run(check('arc-pitch', 'pass'))
 assert.equal(f.snap().openIssues.length, 1)
 f.run(check('world-spacing', 'pass'))
 assert.equal(f.snap().openIssues.length, 0)
 f.set('a.html', 'another untested change')
 assert.equal(f.snap().openIssues[0].status, 'changed-pending')
})

test('same basename, different full object, and different root never provide closure', t => {
 const f = fixture(t)
 mkdirSync(join(f.root, 'sub')); f.set('sub/a.html', 'other artifact')
 f.run(check('world-spacing', 'fail'))
 f.run(check('world-spacing', 'pass', 'sub/a.html'))
 assert.equal(f.snap().openIssues.length, 1)
 f.run(check('world-spacing', 'pass', 'a.html'), {args: {}, extra: {}})
 assert.equal(f.snap().openIssues.length, 0)
 f.set('a.html', 'next untested version')
 const other = join(f.root, 'sub')
 const id = f.begin('check', {artifact: {path: 'a.html'}}, {root: other})
 f.end(id, check('world-spacing', 'pass'), {root: other})
 assert.equal(f.snap().openIssues.length, 1)
})

test('different labels and text-vs-structured check identities never auto-match', t => {
 const f = fixture(t)
 f.run('FAIL spacing varies')
 f.run('PASS spacing stable')
 f.run(check('text:spacing varies', 'pass'))
 assert.equal(f.snap().openIssues.length, 1)
 f.run('PASS spacing varies')
 assert.equal(f.snap().openIssues.length, 0)
})

test('a delayed PASS after an object write stays pending until a newly started retest', t => {
 const f = fixture(t)
 f.run(check('world-spacing', 'fail'))
 const pending = f.begin()
 const write = f.begin('edit', {file_path: 'a.html', old_string: 'initial', new_string: 'repaired'})
 f.set('a.html', 'repaired bytes'); f.end(write, 'edited')
 f.end(pending, check('world-spacing', 'pass'))
 assert.equal(f.snap().openIssues.length, 1)
 assert.equal(f.snap().recentEvidence.at(-1).checks[0].binding.versionStatus, 'stale-result')
 assert.equal(f.snap().recentEvidence.at(-1).checks[0].binding.sha256, null)
 f.run(check('world-spacing', 'pass'))
 assert.equal(f.snap().openIssues.length, 0)
})

test('delayed failure is retained without binding current bytes to an old test', t => {
 const f = fixture(t), pending = f.begin()
 const write = f.begin('write', {file_path: 'a.html', content: 'new'})
 f.set('a.html', 'new'); f.end(write, 'written')
 f.end(pending, check('old-check', 'fail'))
 const issue = f.snap().openIssues[0]
 assert.equal(issue.binding.sha256, null)
 assert.equal(issue.binding.versionStatus, 'stale-result')
})

test('a PASS that was started before the newer failure cannot count as a retest', t => {
 const f = fixture(t), oldPass = f.begin()
 f.run(check('world-spacing', 'fail'))
 f.end(oldPass, check('world-spacing', 'pass'))
 assert.equal(f.snap().openIssues.length, 1)
})

test('explicit writes invalidate only their object while unknown shell writes invalidate conservatively', t => {
 const f = fixture(t)
 f.run(check('world-spacing', 'fail')); f.run(check('world-spacing', 'pass'))
 const write = f.begin('edit', {file_path: 'b.html'}); f.set('b.html', 'other repair'); f.end(write, 'edited')
 assert.equal(f.snap().openIssues.length, 0)
 const unknown = f.begin('bash', {command: 'opaque command'}); f.end(unknown, '[exit code: 0]')
 assert.equal(f.snap().openIssues[0].status, 'changed-pending')
})

test('unknown shell writes make an earlier outstanding PASS stale', t => {
 const f = fixture(t)
 f.run(check('world-spacing', 'fail'))
 const pending = f.begin()
 f.run('[exit code: 0]', {name: 'bash', args: {command: 'opaque write'}})
 f.end(pending, check('world-spacing', 'pass'))
 assert.equal(f.snap().openIssues.length, 1)
})

test('read permission off never captures bytes or accepts a claimed structured hash', t => {
 const f = fixture(t)
 const fake = JSON.stringify({checks: [{id: 'world-spacing', status: 'fail'}], artifact: {path: 'a.html', sha256: sha('private file bytes: initial A')}})
 f.run(fake, {readEnabled: false})
 let snapshot = f.snap({readEnabled: false})
 assert.equal(snapshot.openIssues[0].binding.sha256, null)
 assert.equal(snapshot.openIssues[0].binding.versionStatus, 'read-disabled')
 assert.equal(JSON.stringify(snapshot).includes('private file bytes:'), false)
 f.run(check('world-spacing', 'pass'))
 snapshot = f.snap()
 assert.equal(snapshot.openIssues.length, 1)
 assert.equal(snapshot.openIssues[0].binding.sha256, null)
})

test('revoked permission reopens a closure and re-enabling alone cannot restore it', t => {
 const f = fixture(t)
 f.run(check('world-spacing', 'fail')); f.run(check('world-spacing', 'pass'))
 assert.equal(f.snap().openIssues.length, 0)
 assert.equal(f.snap({readEnabled: false}).openIssues[0].pendingReason, 'read-permission-disabled')
 assert.equal(f.snap().openIssues.length, 1)
 f.run(check('world-spacing', 'pass'))
 assert.equal(f.snap().openIssues.length, 0)
})

test('unbound failures cannot be closed by a same-request PASS', t => {
 const f = fixture(t)
 f.run('FAIL world-spacing', {args: {}})
 f.run('PASS world-spacing', {args: {}})
 assert.equal(f.snap().openIssues.length, 1)
 f.run(check('text:world-spacing', 'pass'))
 assert.equal(f.snap().openIssues.length, 1)
})

test('invocation recovery requires the exact operation and explicit later success, not a product PASS', t => {
 const f = fixture(t), args = {command: 'local operation', artifact: {path: 'a.html'}}
 f.run('FAIL product-check\n[exit code: 2]', {name: 'bash', args})
 assert.equal(f.snap().openIssues.length, 2)
 f.run('[exit code: 0]', {name: 'bash', args: {...args, command: 'different operation'}})
 assert.equal(f.snap().openIssues.length, 2)
 f.run('PASS unrelated', {name: 'bash', args})
 assert.equal(f.snap().openIssues.length, 2)
 f.run(JSON.stringify({exitCode: 0}), {name: 'bash', args})
 assert.equal(f.snap().openIssues.length, 1)
 assert.equal(f.snap().openIssues[0].kind, 'reported-failure')
})

test('an isError invocation cannot close a product check even when its content says PASS', t => {
 const f = fixture(t)
 f.run(check('world-spacing', 'fail'))
 f.run(check('world-spacing', 'pass'), {extra: {isError: true}})
 assert.equal(f.snap().openIssues.filter(i => i.kind === 'reported-failure').length, 1)
 assert.equal(f.snap().openIssues.filter(i => i.kind === 'invocation-failure').length, 1)
})

test('structured check results preserve failed identities and individual artifacts', t => {
 const f = fixture(t)
 f.run(JSON.stringify({checks: [{id: 'spacing', status: 'error', artifact: {path: 'a.html'}}, {id: 'closure', status: 'pass', artifact: {path: 'b.html'}}]}))
 f.run(JSON.stringify({checks: [{id: 'spacing', status: 'pass', artifact: {path: 'b.html'}}]}))
 assert.equal(f.snap().openIssues.length, 1)
 f.run(check('spacing', 'pass'))
 assert.equal(f.snap().openIssues.length, 0)
})

test('mixed structured PASS and actual raw FAIL cannot hide the raw check', t => {
 const f = fixture(t)
 f.run('TRACE result | FAIL world-spacing | PASS arc-pitch', {extra: {structuredContent: {checks: [{id: 'unrelated', status: 'pass'}], artifact: {path: 'a.html'}}}})
 assert.equal(f.snap().openIssues[0].label, 'world-spacing')
})

test('same-output FAIL wins over PASS for exactly the same check', t => {
 const f = fixture(t)
 f.run(check('spacing', 'fail'))
 f.run(JSON.stringify({checks: [{id: 'spacing', status: 'fail'}, {id: 'spacing', status: 'pass'}], artifact: {path: 'a.html'}}))
 assert.equal(f.snap().openIssues.length, 1)
 assert.equal(f.snap().openIssues[0].count, 2)
})

test('claimed result hash must match the actual freshly read version, including cached reads', t => {
 const f = fixture(t)
 f.run(check('spacing', 'fail'))
 f.run(JSON.stringify({checks: [{id: 'unrelated', status: 'pass', artifact: {path: 'a.html', sha256: sha('private file bytes: initial A')}}, {id: 'spacing', status: 'pass', artifact: {path: 'a.html', sha256: sha('old bytes')}}]}))
 assert.equal(f.snap().openIssues.length, 1)
 assert.ok(f.snap().limitations.includes('artifact-reported-hash-mismatch'))
})

test('native/PTC result correlation suppresses root run_code summaries and advisor tools', t => {
 const f = fixture(t), root = f.begin('run_code', {code: 'local fake program'})
 const start = f.emit('tool/ptc-dispatch-start', {subCallId: 'inner', name: 'check', arguments: {artifact: {path: 'a.html'}}, rootCallId: root})
 f.emit('tool/ptc-dispatch', {subCallId: 'inner', rootCallId: root, content: [{type: 'text', text: 'FAIL world-spacing'}]})
 f.end(root, 'FAIL world-spacing')
 for (const name of ['consult_task', 'advisor_stage', 'tools.consult_task', 'mcp__advisor__consult_task']) f.run('FAIL advisor output', {name})
 const snapshot = f.snap()
 assert.equal(snapshot.openIssues.length, 1)
 assert.equal(snapshot.openIssues[0].source.transport, 'ptc')
 assert.equal(snapshot.recentEvidence.length, 1)
 f.memory.observe(f.session, start, {readEnabled: true})
 assert.equal(f.snap().openIssues[0].count, 1)
})

test('duplicate events and duplicate transports count one result, actual repeated runs count repetitions', t => {
 const f = fixture(t), end = f.run('FAIL spacing')
 f.memory.observe(f.session, end, {readEnabled: true})
 f.emit('tool/ptc-dispatch', {subCallId: end.data.message.toolCallId, content: [{type: 'text', text: 'FAIL spacing'}]})
 assert.equal(f.snap().openIssues[0].count, 1)
 f.run('FAIL spacing')
 assert.equal(f.snap().openIssues[0].count, 2)
 assert.deepEqual(f.snap().openIssues[0].refs, ['E3', 'E6'])
})

test('late inner PTC discovery also removes a prior root-only summary', t => {
 const f = fixture(t), root = f.begin('run_code', {code: 'local fake program'})
 f.end(root, 'FAIL root-summary')
 f.emit('tool/ptc-dispatch-start', {subCallId: 'inner', rootCallId: root, name: 'check', arguments: {}})
 f.emit('tool/ptc-dispatch', {subCallId: 'inner', rootCallId: root, content: [{type: 'text', text: 'FAIL actual-inner'}]})
 assert.deepEqual(f.snap().openIssues.map(i => i.label), ['actual-inner'])
})

test('real message source authenticity and cross-task/session isolation are strict', t => {
 const f = fixture(t)
 f.run('FAIL spacing')
 f.input('plugin:direction-generated'); f.input('plugin'); f.input('assistant')
 assert.equal(f.snap().openIssues.length, 1)
 f.emit('tool/result', {source: {kind: 'plugin:direction'}, message: {toolCallId: 'fake', content: 'FAIL fake result'}})
 f.emit('tool/result', {message: {toolCallId: 'never-called', content: 'FAIL uncorrelated'}})
 assert.equal(f.snap().openIssues.length, 1)
 const other = {...f.session, id: 'session-B'}
 f.memory.observe(other, user(1))
 f.memory.observe(other, call(2, 'b'))
 f.memory.observe(other, result(3, 'b', 'PASS spacing'))
 assert.equal(f.snap().openIssues.length, 1)
 assert.equal(f.memory.snapshot({sessionId: other.id, requestId: 'human:1'}).openIssues.length, 0)
 const oldCall = f.begin()
 f.input()
 assert.equal(f.snap().openIssues.length, 0)
 f.end(oldCall, 'FAIL old task result')
 f.memory.observe(f.session, user(1))
 assert.equal(f.snap().openIssues.length, 0)
})

test('a request ID mismatch leaks no previous task evidence', t => {
 const f = fixture(t)
 f.run('FAIL spacing')
 const snapshot = f.snap({requestId: 'human:999'})
 assert.deepEqual(snapshot.openIssues, [])
 assert.deepEqual(snapshot.recentEvidence, [])
 assert.equal(snapshot.completionClaimAllowed, false)
 assert.ok(snapshot.limitations.includes('request-id-mismatch'))
})

test('seed uses only the latest actual user slice and never hashes historical results', t => {
 const f = fixture(t)
 const events = [user(1), call(2, 'old'), result(3, 'old', 'FAIL old task'), user(4), call(5, 'new', 'check', {artifact: {path: 'a.html'}}), result(6, 'new', check('spacing', 'fail')), user(7, 'plugin:direction'), {seq: 8, type: 'assistant/message', data: {content: 'PASS spacing'}}]
 const memory = createInferenceEvidence(), session = {...f.session, snapshotEvents: () => events}
 memory.seed(session, {readEnabled: true})
 const snapshot = memory.snapshot({sessionId: session.id, requestId: 'human:4', root: f.root, readEnabled: true})
 assert.equal(snapshot.openIssues.length, 1)
 assert.equal(snapshot.openIssues[0].checkId, 'spacing')
 assert.equal(snapshot.openIssues[0].binding.sha256, null)
 assert.equal(snapshot.openIssues[0].binding.versionStatus, 'historical-unknown')
 assert.equal(snapshot.recentEvidence[0].historical, true)
 memory.observe(session, call(9, 'fresh', 'check', {artifact: {path: 'a.html'}}), {readEnabled: true})
 memory.observe(session, result(10, 'fresh', check('spacing', 'pass')), {readEnabled: true})
 assert.equal(memory.snapshot({sessionId: session.id, requestId: 'human:4', root: f.root, readEnabled: true}).openIssues.length, 1)
})

test('seeding after live observation preserves the live original hash and repeat count', t => {
 const f = fixture(t)
 f.run(check('spacing', 'fail'))
 const original = f.snap().openIssues[0].binding.sha256
 f.set('a.html', 'changed after the actual result')
 f.memory.seed(f.session, {readEnabled: true})
 const snapshot = f.snap()
 assert.equal(snapshot.openIssues[0].binding.sha256, original)
 assert.equal(snapshot.openIssues[0].count, 1)
 assert.equal(snapshot.openIssues[0].status, 'changed-pending')
})

test('persisted live hashes survive reload while historical unknown hashes remain unknown', t => {
 const home = mkdtempSync(join(tmpdir(), 'po06-evidence-home-')); t.after(() => rmSync(home, {recursive: true, force: true}))
 const f = fixture(t, {home, namespace: 'profile-A'})
 f.run(check('spacing', 'fail'))
 const stored = readFileSync(storeFile(home, 'profile-A'), 'utf8')
 assert.equal(stored.includes('private file bytes:'), false)
 assert.equal(stored.includes('local operation'), false)
 const memory = createInferenceEvidence({home, namespace: 'profile-A'})
 let snapshot = memory.snapshot({sessionId: f.session.id, requestId: 'human:1', root: f.root, readEnabled: true})
 assert.equal(snapshot.openIssues[0].binding.sha256, sha('private file bytes: initial A'))
 memory.observe(f.session, call(4, 'new-live', 'check', {artifact: {path: 'a.html'}}), {readEnabled: true})
 memory.observe(f.session, result(5, 'new-live', check('spacing', 'pass')), {readEnabled: true})
 snapshot = memory.snapshot({sessionId: f.session.id, requestId: 'human:1', root: f.root, readEnabled: true})
 assert.equal(snapshot.openIssues.length, 0)
 assert.equal(readdirSync(join(home, 'po06-inference-evidence', sha('profile-A').slice(0, 16))).some(n => n.includes('.tmp-')), false)
 const other = createInferenceEvidence({home, namespace: 'other-profile'})
 assert.equal(other.snapshot({sessionId: f.session.id, requestId: 'human:1'}).recentEvidence.length, 0)
})

test('a persisted pending invocation cannot acquire live version authority from an old call', t => {
 const home = mkdtempSync(join(tmpdir(), 'po06-evidence-home-')); t.after(() => rmSync(home, {recursive: true, force: true}))
 const f = fixture(t, {home, namespace: 'pending'})
 f.run(check('spacing', 'fail'))
 const id = f.begin()
 const memory = createInferenceEvidence({home, namespace: 'pending'})
 memory.observe(f.session, result(5, id, check('spacing', 'pass')), {readEnabled: true})
 const snapshot = memory.snapshot({sessionId: f.session.id, requestId: 'human:1', root: f.root, readEnabled: true})
 assert.equal(snapshot.openIssues.length, 1)
 assert.equal(snapshot.recentEvidence.at(-1).checks[0].binding.sha256, null)
})

test('corrupt persistence and malformed but checksummed metadata are limitations, never closure authority', t => {
 const home = mkdtempSync(join(tmpdir(), 'po06-evidence-home-')); t.after(() => rmSync(home, {recursive: true, force: true}))
 const f = fixture(t, {home, namespace: 'corrupt'})
 f.run(check('spacing', 'fail'))
 const path = storeFile(home, 'corrupt'), saved = JSON.parse(readFileSync(path, 'utf8'))
 saved.payload.issues[0].binding.sha256 = sha('forged bytes')
 writeFileSync(path, JSON.stringify(saved))
 const memory = createInferenceEvidence({home, namespace: 'corrupt'})
 let snapshot = memory.snapshot({sessionId: f.session.id, requestId: 'human:1', root: f.root, readEnabled: true})
 assert.ok(snapshot.limitations.includes('persisted-evidence-unavailable-or-corrupt'))
 assert.equal(snapshot.completionClaimAllowed, false)
 saved.payload.issues[0].binding.sha256 = 'not-a-sha256'
 saved.integrity = sha(JSON.stringify(saved.payload)); writeFileSync(path, JSON.stringify(saved))
 const invalid = createInferenceEvidence({home, namespace: 'corrupt'})
 assert.doesNotThrow(() => invalid.seed(f.session))
 snapshot = invalid.snapshot({sessionId: f.session.id, requestId: 'human:1', root: f.root, readEnabled: true})
 assert.ok(snapshot.limitations.includes('persisted-evidence-unavailable-or-corrupt'))
 assert.equal(snapshot.openIssues[0].binding.sha256, null)
})

test('bounded memory preserves known pending failures with explicit omission counts', t => {
 const f = fixture(t, {limit: 2})
 f.run(JSON.stringify({checks: ['one', 'two', 'three', 'four'].map(id => ({id, status: 'fail'})), artifact: {path: 'a.html'}}))
 f.run(check('unrelated', 'pass')); f.run(check('unrelated', 'pass'))
 const snapshot = f.snap()
 assert.equal(snapshot.mode, 'diagnose')
 assert.equal(snapshot.openIssues.filter(i => i.kind === 'reported-failure').length, 2)
 assert.equal(snapshot.omitted.openIssues, 2)
 assert.equal(snapshot.openIssues.at(-1).kind, 'omitted-reported-failures')
 assert.equal(snapshot.openIssues.at(-1).count, 2)
 assert.equal(snapshot.recentEvidence.length, 2)
 assert.ok(snapshot.omitted.recentEvidence > 0)
})

test('excerpts stay bounded and repeated reports preserve time and count', t => {
 const f = fixture(t)
 f.run('ERROR ' + 'x'.repeat(1500))
 assert.equal(f.snap().openIssues.length, 1) // The report survives; a long free-text identity is left unknown.
 assert.equal(f.snap().openIssues[0].checkId, null)
 f.run('FAIL spacing\n' + 'x'.repeat(3000)); f.run('FAIL spacing')
 const issue = f.snap().openIssues.find(i => i.label === 'spacing')
 assert.equal(issue.count, 2)
 assert.ok(issue.lastSeenAt > issue.firstSeenAt)
 assert.ok(f.snap().recentEvidence.every(e => e.excerpt.length <= 1200))
})

test('outside, missing and oversized artifacts cannot provide version authority', t => {
 const f = fixture(t)
 f.run(check('outside', 'fail', '../outside.html'))
 f.run(check('missing', 'fail', 'missing.html'))
 f.set('huge.bin', Buffer.alloc(2 * 1024 * 1024 + 1, 1))
 f.run(check('huge', 'fail', 'huge.bin'))
 const snapshot = f.snap()
 assert.ok(snapshot.openIssues.every(i => !i.binding?.sha256))
 assert.ok(snapshot.limitations.includes('artifact-outside-root-or-invalid'))
 assert.ok(snapshot.limitations.includes('artifact-version-unavailable'))
})

test('readBounded prevents symlink escape and a changed in-root symlink target is a different binding', t => {
 const f = fixture(t), outside = mkdtempSync(join(tmpdir(), 'po06-outside-'))
 t.after(() => rmSync(outside, {recursive: true, force: true}))
 writeFileSync(join(outside, 'secret.html'), 'outside private bytes')
 try { symlinkSync(join(outside, 'secret.html'), join(f.root, 'escape.html'), 'file') } catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Host does not permit file symlinks'); return } throw error }
 f.run(check('escape', 'fail', 'escape.html'))
 assert.equal(f.snap().openIssues[0].binding.sha256, null)
 assert.equal(JSON.stringify(f.snap()).includes('outside private bytes'), false)
 symlinkSync(join(f.root, 'a.html'), join(f.root, 'alias.html'), 'file')
 f.run(check('alias', 'fail', 'alias.html'))
 rmSync(join(f.root, 'alias.html')); symlinkSync(join(f.root, 'b.html'), join(f.root, 'alias.html'), 'file')
 f.run(check('alias', 'pass', 'alias.html'))
 assert.equal(f.snap().openIssues.some(i => i.checkId === 'alias'), true)
})



test('shell description changes do not change operation identity while command changes do', t => {
 const f = fixture(t)
 f.run('[exit code: 1]', {name: 'bash', args: {command: 'same local operation', description: 'old display label'}})
 assert.match(f.snap().openIssues[0].pendingReason, /not-a-product-check/)
 f.run('[exit code: 0]', {name: 'bash', args: {command: 'same local operation', description: 'new display label'}})
 assert.equal(f.snap().openIssues.length, 0)
})

test('structured shell stdout and direct structured content retain reported failures', t => {
 const f = fixture(t)
 f.run(JSON.stringify({kind: 'foreground', exitCode: 1, stdout: {text: 'FAIL measured-spacing'}, stderr: {text: 'ERROR command-output'}}), {name: 'pwsh', args: {command: 'fake local operation'}})
 assert.equal(f.snap().openIssues.filter(i => i.kind === 'reported-failure').length, 2)
 assert.equal(f.snap().openIssues.filter(i => i.kind === 'invocation-failure').length, 1)
 const id = f.begin()
 f.emit('tool/result', {message: {toolCallId: id, content: {checks: [{id: 'direct-check', status: 'error'}], artifact: {path: 'a.html'}}}})
 assert.ok(f.snap().openIssues.some(i => i.checkId === 'direct-check'))
})

test('missing and oversized structured identities retain failures without guessing a check match', t => {
 const f = fixture(t)
 f.run(JSON.stringify({checks: [{status: 'error', message: 'actual reported error'}, {id: 'x'.repeat(1000), status: 'failed'}], artifact: {path: 'a.html'}}))
 const snapshot = f.snap()
 assert.ok(snapshot.openIssues.length > 0)
 assert.ok(snapshot.openIssues.every(i => i.checkId === null))
 assert.equal(snapshot.openIssues.reduce((sum, i) => sum + i.count, 0), 2)
})

test('the same text label emitted by a different tool cannot silently resolve a failure', t => {
 const f = fixture(t)
 f.run('FAIL spacing', {name: 'check-A'})
 f.run('PASS spacing', {name: 'check-B'})
 assert.equal(f.snap().openIssues.length, 1)
 f.run('PASS spacing', {name: 'check-A'})
 assert.equal(f.snap().openIssues.length, 0)
})

test('persisted malformed closed metadata cannot suppress an actually seeded failure', t => {
 const home = mkdtempSync(join(tmpdir(), 'po06-evidence-home-')); t.after(() => rmSync(home, {recursive: true, force: true}))
 const f = fixture(t, {home, namespace: 'bad-closure'})
 f.run(check('spacing', 'fail'))
 const path = storeFile(home, 'bad-closure'), state = JSON.parse(readFileSync(path, 'utf8'))
 state.payload.issues[0].status = 'closed-by-tool-evidence'
 state.payload.issues[0].resolution = {sourceId: 'E999', seq: 999, callId: 'fake', sha256: 'not-a-hash', actualPath: state.payload.issues[0].binding.actualPath, observedAt: 1000, valid: true}
 state.integrity = sha(JSON.stringify(state.payload)); writeFileSync(path, JSON.stringify(state))
 const memory = createInferenceEvidence({home, namespace: 'bad-closure'})
 memory.seed(f.session)
 const snapshot = memory.snapshot({sessionId: f.session.id, requestId: 'human:1', root: f.root, readEnabled: true})
 assert.equal(snapshot.openIssues.length, 1)
 assert.ok(snapshot.limitations.includes('persisted-evidence-unavailable-or-corrupt'))
 assert.equal(snapshot.openIssues[0].binding.sha256, null)
})

test('a later seed notices a newer genuine human even when its live event was missed', t => {
 const f = fixture(t)
 f.run(check('old-task', 'fail')); f.memory.seed(f.session)
 const events = [...f.events, user(10), call(11, 'new-task', 'check', {artifact: {path: 'b.html'}}), result(12, 'new-task', check('new-check', 'fail', 'b.html'))]
 f.memory.seed({...f.session, snapshotEvents: () => events}, {readEnabled: true})
 const snapshot = f.memory.snapshot({sessionId: f.session.id, requestId: 'human:10', root: f.root, readEnabled: true})
 assert.deepEqual(snapshot.openIssues.map(i => i.checkId), ['new-check'])
 assert.equal(snapshot.openIssues[0].binding.sha256, null)
 assert.equal(f.snap().recentEvidence.length, 0)
})

test('a quoted expected-failure segment cannot hide an independent actual failure on the same line', t => {
 const f = fixture(t)
 f.run('TRACE sample | FAIL actual-spacing | FAIL expected-failure fixture\nFAIL examples-panel')
 assert.deepEqual(f.snap().openIssues.map(i => i.label), ['actual-spacing', 'examples-panel'])
})

test('clear removes only that session and disabled observation is a no-op', t => {
 const f = fixture(t)
 f.run('FAIL spacing')
 f.memory.observe(f.session, user(99), {enabled: false})
 assert.equal(f.snap().openIssues.length, 1)
 assert.deepEqual(f.memory.clear(f.session.id), {cleared: true})
 assert.equal(f.snap().openIssues.length, 0)
})


test('a real stderr syntax failure survives a compound command that finally exits zero',t=>{
 const f=fixture(t),args={command:'python fix.py; build final artifact',workdir:'.',description:'Apply instrumentation correction'}
 f.run('[stdout]\nhtml=1457333B\n[stderr]\n  File "fix.py", line 6\nSyntaxError: \'(\' was never closed\n[exit code: 0]',{name:'bash',args})
 const issue=f.snap().openIssues[0]
 assert.equal(issue.kind,'invocation-failure');assert.match(issue.label,/SyntaxError/)
 assert.match(issue.excerpt,/never closed/)
 f.run('ALL PASS unrelated scalar subset\n[exit code: 0]',{name:'bash',args:{command:'different smoke test'}})
 assert.ok(f.snap().openIssues.some(i=>/SyntaxError/.test(i.label)))
 f.run('[stdout]\ncorrected instrument ran\n[exit code: 0]',{name:'bash',args:{...args,description:'Retest same operation with no stderr diagnostic'}})
 assert.equal(f.snap().openIssues.length,0,'same-operation invocation recovery is not a product acceptance claim')
 assert.equal(f.snap().completionClaimAllowed,false)
})

test('quoted/fenced diagnostic examples are ignored while an uncaught real error remains',t=>{
 const f=fixture(t),fence=String.fromCharCode(96).repeat(3)
 f.run(['> SyntaxError: example','"TypeError: quoted"',fence,'ReferenceError: fenced sample',fence,'Uncaught TypeError: cannot read property x'].join('\n'),{name:'bash'})
 const issues=f.snap().openIssues
 assert.equal(issues.length,1);assert.equal(issues[0].kind,'invocation-failure');assert.match(issues[0].excerpt,/cannot read property x/)
})


test('skip, unknown and pending retests cannot close a failed check, while a later actual pass can',t=>{
 const f=fixture(t)
 f.run(check('same-observable','fail'))
 for(const status of ['skip','skipped','unknown','pending','todo','not-run']){
  f.run(check('same-observable',status))
  assert.equal(f.snap().openIssues.length,1,status+' must not become a pass')
 }
 f.run(check('same-observable','pass'))
 assert.equal(f.snap().openIssues.length,0)
 assert.equal(f.snap().completionClaimAllowed,false)
})
