export class InvocationIdentityChangedError extends Error {
  readonly code = 'resource_identity_changed'

  constructor() {
    super('调用目标身份已变化')
  }
}

export interface InvocationIdentityBinder<TIdentity> {
  assert(expected: TIdentity, current: TIdentity | undefined): void
}

/** 在副作用开始前比较授权快照与当前资源身份。 */
export function createInvocationIdentityBinder<TIdentity>(
  serialize: (identity: TIdentity) => string = JSON.stringify,
): InvocationIdentityBinder<TIdentity> {
  return {
    assert(expected, current) {
      if (current === undefined || serialize(expected) !== serialize(current)) {
        throw new InvocationIdentityChangedError()
      }
    },
  }
}
