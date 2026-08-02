import type { Profile } from '../../shared/contracts/profile.ts'

export interface ProfileRepository {
  list(): Profile[]
  get(profileId: string): Profile | undefined
  save(profile: Profile): Profile
  delete(profileId: string): void
}

/** 测试与无持久化场景的内存实现。 */
export class MemoryProfileRepository implements ProfileRepository {
  readonly #profiles = new Map<string, Profile>()

  list(): Profile[] {
    return [...this.#profiles.values()]
  }

  get(profileId: string): Profile | undefined {
    return this.#profiles.get(profileId)
  }

  save(profile: Profile): Profile {
    this.#profiles.set(profile.id, profile)
    return profile
  }

  delete(profileId: string): void {
    this.#profiles.delete(profileId)
  }
}
