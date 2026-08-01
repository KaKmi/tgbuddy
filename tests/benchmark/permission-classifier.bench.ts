import { createRiskClassifier } from '../../src/runtime/permissions/risk-classifier.ts'
import type { CompleteInvocation } from '../../src/runtime/permissions/invocation-normalizer.ts'

const classifier = createRiskClassifier({ policyVersion: 'permission-v2' })
const fixture: CompleteInvocation = {
  status: 'complete',
  invocation: {
    sessionId: 'benchmark-session',
    toolCallId: 'benchmark-tool',
    toolName: 'bash',
    args: { command: 'bun test' },
    kind: 'shell',
    shell: {
      command: 'bun test',
      dialect: 'auto',
      tokens: ['bun', 'test'],
      compound: false,
      redirected: false,
      hasCommandSubstitution: false,
      wrapper: true,
    },
    targets: [{ kind: 'service', value: 'shell' }],
    fingerprint: 'benchmark-fingerprint',
    resourceIdentityHash: 'benchmark-shell',
  },
  evidence: {
    completeness: 'complete',
    policyVersion: 'permission-v2',
    factors: ['shell'],
    targets: [{ kind: 'service', value: 'shell' }],
    irreversible: false,
    sensitive: false,
    fingerprint: 'benchmark-fingerprint',
    resourceIdentityHash: 'benchmark-shell',
  },
}

for (let index = 0; index < 1_000; index += 1) classifier.classify(fixture)
const samples = Array.from({ length: 10_000 }, () => {
  const started = performance.now()
  classifier.classify(fixture)
  return performance.now() - started
}).sort((left, right) => left - right)
const p95 = samples[Math.floor(samples.length * 0.95)] ?? Number.POSITIVE_INFINITY
console.info(`[权限分类基准] p95=${p95.toFixed(3)}ms`)
if (p95 >= 2) {
  throw new Error(`RiskClassifier p95 ${p95.toFixed(3)}ms >= 2ms`)
}
