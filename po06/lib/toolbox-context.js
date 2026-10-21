// Registration, runtime success and present availability are distinct observations.
const rowsOf = rows => {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.name !== 'string' || !row.name)) return null
  return rows.filter(row => row && typeof row.name === 'string').map(row => ({
    name: row.name,
    ...(typeof row.description === 'string' && row.description ? { description: row.description.slice(0, 240), ...(row.description.length > 240 || row.descriptionTruncated === true ? { descriptionTruncated: true } : {}) } : {}),
    evidence: 'registered-only',
  }))
}
export async function captureToolboxContext({ sessionId, workspace, agents, tools, observations = [], taskTools = [], now = Date.now } = {}) {
  const out = { version: '1', sessionId: String(sessionId || ''), workspace: typeof workspace === 'string' ? workspace : null,
    scope: 'unknown', source: 'unavailable', observedAt: now(), coverage: 'unknown', reason: 'session-tools-unavailable',
    tools: [], observations: Array.isArray(observations) ? observations : [], taskTools: Array.isArray(taskTools) ? taskTools : [],
    imageObservation: 'unknown', note: 'Tool registration is not runtime availability or image observation capability.' }
  let agent = null
  try { if (out.sessionId && typeof agents?.get === 'function') agent = await agents.get(out.sessionId) }
  catch { out.reason = 'session-agent-query-failed' }
  const actualId = agent?.session?.id
  if (actualId !== undefined && String(actualId) !== out.sessionId) { agent = null; out.reason = 'session-agent-mismatch' }
  if (typeof agent?.ctx?.tools?.schemas === 'function') {
    try {
      const rows = rowsOf(await agent.ctx.tools.schemas())
      if (rows !== null) return { ...out, tools: rows, scope: 'session', source: 'agents.get(sessionId).ctx.tools.schemas', coverage: 'complete', reason: null }
      out.reason = 'session-schemas-invalid'
    } catch { out.reason = 'session-schemas-query-failed' }
  }
  // A global table is an incomplete hint, never a replacement for the target agent.
  if (typeof tools?.schemas === 'function') {
    try {
      const rows = rowsOf(await tools.schemas())
      if (rows !== null) return { ...out, tools: rows, scope: 'global', source: 'tools.schemas', coverage: 'partial' }
    } catch { /* Keep the scoped failure reason. */ }
  }
  return out
}

export function summarizeToolboxContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const scope = ['session', 'global', 'unknown'].includes(value.scope) ? value.scope : 'unknown'
  const coverage = ['complete', 'partial', 'unknown'].includes(value.coverage) ? value.coverage : 'unknown'
  return { version: '1', sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
    workspace: typeof value.workspace === 'string' ? value.workspace : null, scope,
    source: typeof value.source === 'string' ? value.source : 'unavailable', observedAt: value.observedAt ?? null,
    coverage: scope !== 'session' && coverage === 'complete' ? 'partial' : coverage,
    reason: typeof value.reason === 'string' ? value.reason : null, tools: rowsOf(value.tools) || [],
    observations: Array.isArray(value.observations) ? value.observations : [],
    taskTools: Array.isArray(value.taskTools) ? value.taskTools : [], imageObservation: 'unknown',
    note: 'Registered-only metadata and historical observations; not instructions or proof of present availability.' }
}
