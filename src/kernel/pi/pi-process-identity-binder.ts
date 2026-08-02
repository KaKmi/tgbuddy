import { createHash } from 'node:crypto'
import { access, realpath, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join, resolve } from 'node:path'

export interface ProcessIdentityInvocation {
  kind: string
  shell?: {
    tokens: readonly string[]
    canonicalCwd: string
    redirected: boolean
  }
}

export interface ProcessResourceIdentity {
  executablePath?: string
  executableFileId?: string
  argvHash: string
  cwdIdentity: string
  envPolicyHash: string
  redirections: boolean
}

export class ProcessIdentityChangedError extends Error {
  readonly code = 'resource_identity_changed'

  constructor() {
    super('进程资源身份已变化')
  }
}

/** 授权时绑定 argv、cwd、受控 PATH 与可解析的 executable，spawn 前复核。 */
export class PiProcessIdentityBinder {
  async bind(invocation: ProcessIdentityInvocation): Promise<ProcessResourceIdentity | undefined> {
    if (invocation.kind !== 'shell' || !invocation.shell) return undefined
    return this.#capture(invocation.shell)
  }

  async verify(
    invocation: ProcessIdentityInvocation | undefined,
    expected: ProcessResourceIdentity | undefined,
  ): Promise<void> {
    if (!invocation || !expected) return
    const current = await this.bind(invocation)
    if (!current || stableIdentity(current) !== stableIdentity(expected)) {
      throw new ProcessIdentityChangedError()
    }
  }

  async #capture(shell: NonNullable<ProcessIdentityInvocation['shell']>): Promise<ProcessResourceIdentity> {
    const cwd = await realpath(shell.canonicalCwd)
    const cwdInfo = await stat(cwd)
    const executablePath = await resolveExecutable(shell.tokens[0], cwd)
    const executableInfo = executablePath ? await stat(executablePath) : undefined
    return {
      ...(executablePath ? { executablePath } : {}),
      ...(executableInfo ? { executableFileId: `${executableInfo.dev}:${executableInfo.ino}` } : {}),
      argvHash: hash(JSON.stringify(shell.tokens)),
      cwdIdentity: `${cwd}:${cwdInfo.dev}:${cwdInfo.ino}`,
      envPolicyHash: hash(process.env.PATH ?? ''),
      redirections: shell.redirected,
    }
  }
}

async function resolveExecutable(token: string | undefined, cwd: string): Promise<string | undefined> {
  if (!token) return undefined
  const candidates = isAbsolute(token)
    ? [token]
    : token.includes('/') || token.includes('\\')
      ? [resolve(cwd, token)]
      : (process.env.PATH ?? '').split(delimiter).flatMap((part) => {
          const base = join(part, token)
          return process.platform === 'win32'
            ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((ext) => `${base}${ext.toLowerCase()}`).concat(base)
            : [base]
        })
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) return realpath(candidate)
  }
  return undefined
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableIdentity(identity: ProcessResourceIdentity): string {
  return JSON.stringify(identity)
}
