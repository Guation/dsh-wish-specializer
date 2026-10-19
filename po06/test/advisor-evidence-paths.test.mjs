// issue #35 回归：非 Windows 平台上，root 内的**绝对路径**必须拿到相对键。
//
// 旧实现用 `win32.isAbsolute(raw)` 一刀切，而 win32 语义下以 "/" 开头就算绝对路径
// ⇒ Linux/macOS 上 /tmp/r/a.js 明明在 root 里也被判成 null，命中数恒 0。
// 这里用 opts.platform 显式模拟另一套平台语义（本机是 Windows，真机 Linux 行为一致）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { evidencePathIdentity } from '../lib/advisor-evidence.js'

const linux = { platform: 'linux' }
const mac = { platform: 'darwin' }
const win = { platform: 'win32' }

test('POSIX：root 内的绝对路径映射成相对键（issue #35 的第一诉求）', () => {
  assert.equal(evidencePathIdentity('/tmp/r/a.js', '/tmp/r', linux), 'a.js')
  assert.equal(evidencePathIdentity('/tmp/r/sub/b.png', '/tmp/r', linux), 'sub/b.png')
  assert.equal(evidencePathIdentity('/tmp/r/a.js', '/tmp/r', mac), 'a.js', 'macOS 同一套语义')
  // advisor-coverage 用 root="/" 比对前后两次的 subject
  assert.equal(evidencePathIdentity('/tmp/r/a.js', '/', linux), 'tmp/r/a.js')
})

test('POSIX：越界、盘符、UNC 仍然拒收', () => {
  assert.equal(evidencePathIdentity('/etc/passwd', '/tmp/r', linux), null, 'root 外')
  assert.equal(evidencePathIdentity('/tmp/r/../x', '/tmp/r', linux), null, '解析后越界')
  assert.equal(evidencePathIdentity('C:\\x', '/tmp/r', linux), null, 'Windows 盘符路径不许当 POSIX 相对键')
  assert.equal(evidencePathIdentity('C:/x', '/tmp/r', linux), null)
  assert.equal(evidencePathIdentity('//server/share/x', '/tmp/r', linux), null, 'UNC')
  assert.equal(evidencePathIdentity('a.js', '/tmp/r', linux), 'a.js', '相对路径照旧')
})

test('Windows：行为不变（不得为了修 POSIX 把 Windows 改坏）', () => {
  assert.equal(evidencePathIdentity('C:\\r\\a.js', 'C:\\r', win), 'a.js')
  assert.equal(evidencePathIdentity('C:\\r\\a.js', 'C:\\r'), 'a.js', '真机平台推断也一致')
  assert.equal(evidencePathIdentity('/etc/passwd', 'C:\\r', win), null, 'root 外')
  assert.equal(evidencePathIdentity('C:\\other\\a.js', 'C:\\r', win), null, '盘符内但越界')
})
