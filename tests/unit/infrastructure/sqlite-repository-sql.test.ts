import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'src',
  'infrastructure',
  'sqlite',
  'repositories',
  'sqlite-session-repository.ts',
)

function countItems(list: string): number {
  return list.split(',').map((item) => item.trim()).filter(Boolean).length
}

describe('SqliteSessionRepository SQL 一致性', () => {
  test('INSERT 列数与 VALUES 占位符一致（避免 profile_id 等新列错位）', () => {
    const source = readFileSync(REPO, 'utf8')
    const insert = source.match(/INSERT INTO app_sessions \(\s*([\s\S]*?)\s*\) VALUES \(([^)]*)\)/)
    expect(insert).not.toBeNull()
    if (!insert) return
    const columns = countItems(insert[1]!)
    const placeholders = countItems(insert[2]!)
    expect(columns).toBe(placeholders)
    expect(columns).toBe(20)
  })

  test('UPDATE SET 列数加 WHERE id 与参数数量一致', () => {
    const source = readFileSync(REPO, 'utf8')
    const update = source.match(/UPDATE app_sessions\s+SET\s+([\s\S]*?)\s+WHERE id = \?/)
    expect(update).not.toBeNull()
    if (!update) return
    const setColumns = countItems(update[1]!)
    // run(...sessionValues(session).slice(1), session.id)
    expect(setColumns + 1).toBe(20)
  })

  test('sessionValues 与 SELECT 列一一对应', () => {
    const source = readFileSync(REPO, 'utf8')
    const select = source.match(/const SELECT_COLUMNS = `\s*([\s\S]*?)`/)
    const values = source.match(/function sessionValues[\s\S]*?return \[([\s\S]*?)\n  \]/)
    expect(select).not.toBeNull()
    expect(values).not.toBeNull()
    if (!select || !values) return
    const selectItems = countItems(select[1]!)
    const valueItems = values[1]!.split('\n').filter((line) => line.trim() && !line.trim().startsWith('//')).length
    expect(valueItems).toBe(selectItems)
  })

  test('profile_id 是 NOT NULL 列，写入用空串而非 null', () => {
    const source = readFileSync(REPO, 'utf8')
    expect(source).toContain("session.profileId ?? ''")
    const migration = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'src', 'infrastructure', 'sqlite', 'migrations', '012_app_sessions_profile_id.sql'),
      'utf8',
    )
    expect(migration).toContain("DEFAULT ''")
  })
})

describe('Permission v2 SQLite 契约', () => {
  test('迁移禁用 legacy prefix，并持久化 plan effects', () => {
    const migration = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'src', 'infrastructure', 'sqlite', 'migrations', '019_app_permission_v2.sql'),
      'utf8',
    )
    expect(migration).toContain("CASE WHEN match = 'prefix' THEN 0 ELSE 1 END")
    expect(migration).toContain('CREATE TABLE app_plan_effects')
    expect(migration).toContain('plan_revision INTEGER NOT NULL')
    expect(migration).toContain('subject_json TEXT NOT NULL')
  })
})
