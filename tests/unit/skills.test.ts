import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFsSkillCatalog,
  seedBuiltinSkills,
} from '../../src/infrastructure/skills/index.ts'
import {
  parseSkillManifest,
} from '../../src/shared/skill-manifest-parser.ts'

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tgbuddy-skill-test-'))
  return root
}

function writeSkill(
  root: string,
  dirName: string,
  manifest: Record<string, unknown>,
): string {
  const dir = join(root, dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'skill.json'), JSON.stringify(manifest), 'utf8')
  return dir
}

/** 把内置源 seed 进用户级目录，并返回 catalog 需要的 userRoot。 */
function seededUserRoot(seedDir: string): string {
  const userDir = makeRoot()
  seedBuiltinSkills({ sourceRoots: [seedDir], targetRoot: userDir })
  return userDir
}

describe('Skill manifest parser', () => {
  test('合法 manifest 解析出稳定 id 与元数据', () => {
    const skill = parseSkillManifest(
      {
        name: 'reg-check',
        title: '监管口径核对',
        description: '按监管问答核对口径',
        version: '1.0.0',
        trigger: '监管|口径核对',
        tags: ['市场'],
      },
      { source: 'builtin', root: '/skills/reg-check' },
    )
    expect(skill.id).toBe('builtin:reg-check')
    expect(skill.source).toBe('builtin')
    expect(skill.title).toBe('监管口径核对')
    expect(skill.enabled).toBe(true)
  })

  test('缺少必填字段的 manifest 抛出可诊断错误', () => {
    expect(() =>
      parseSkillManifest(
        { name: 'no-title' },
        { source: 'user', root: '/skills/no-title' },
      ),
    ).toThrow(/title/)
  })

  test('name 为空或非法时报错，避免产生不稳定 id', () => {
    expect(() =>
      parseSkillManifest(
        { name: '', title: 'x', description: 'd', version: '1' },
        { source: 'user', root: '/skills/x' },
      ),
    ).toThrow(/name/)
  })
})

describe('FsSkillCatalog', () => {
  test('标准 SKILL.md frontmatter 技能（无 skill.json）也能被发现', () => {
    const seedDir = makeRoot()
    const userDir = seededUserRoot(seedDir)
    try {
      mkdirSync(join(seedDir, 'pdf'), { recursive: true })
      writeFileSync(
        join(seedDir, 'pdf', 'SKILL.md'),
        '---\nname: pdf\ndescription: PDF 处理指南\nversion: "1.0.1"\n---\n\n# PDF\n正文',
        'utf8',
      )
      seedBuiltinSkills({ sourceRoots: [seedDir], targetRoot: userDir })
      const catalog = createFsSkillCatalog({
        userRoots: [userDir],
        workspaceRoots: () => [],
      })
      const item = catalog.groups('ws-1')[0]?.items[0]
      expect(item?.name).toBe('pdf')
      expect(item?.title).toBe('pdf')
      expect(item?.version).toBe('1.0.1')
      expect(item?.description).toContain('PDF 处理指南')
    } finally {
      rmSync(seedDir, { recursive: true, force: true })
      rmSync(userDir, { recursive: true, force: true })
    }
  })

  test('SKILL.md 缺少 name/description 时跳过并记录诊断', () => {
    const seedDir = makeRoot()
    const userDir = seededUserRoot(seedDir)
    try {
      mkdirSync(join(seedDir, 'bad-skill'), { recursive: true })
      writeFileSync(join(seedDir, 'bad-skill', 'SKILL.md'), '没有 frontmatter', 'utf8')
      seedBuiltinSkills({ sourceRoots: [seedDir], targetRoot: userDir })
      const catalog = createFsSkillCatalog({
        userRoots: [userDir],
        workspaceRoots: () => [],
      })
      const groups = catalog.groups('ws-1')
      expect(groups[0]?.items).toHaveLength(0)
      expect(groups[1]?.items).toHaveLength(0)
    } finally {
      rmSync(seedDir, { recursive: true, force: true })
      rmSync(userDir, { recursive: true, force: true })
    }
  })

  test('发现内置/用户级/工作区技能并按来源分组', () => {
    const seedDir = makeRoot()
    const userDir = seededUserRoot(seedDir)
    const wsRoot = makeRoot()
    try {
      writeSkill(seedDir, 'reg-check', {
        name: 'reg-check',
        title: '监管口径核对',
        description: '内置技能',
        version: '1.0.0',
      })
      seedBuiltinSkills({ sourceRoots: [seedDir], targetRoot: userDir })
      // 用户自装技能：直接放用户目录、无 builtin 标记
      writeSkill(userDir, 'trade-clean', {
        name: 'trade-clean',
        title: '成交数据清洗',
        description: '用户级技能',
        version: '1.0.0',
      })
      writeSkill(wsRoot, 'fe-debug', {
        name: 'fe-debug',
        title: '前端调试',
        description: '工作区技能',
        version: '1.0.0',
      })
      const catalog = createFsSkillCatalog({
        userRoots: [userDir],
        workspaceRoots: () => [wsRoot],
      })

      const groups = catalog.groups('ws-1')
      expect(groups.map((group) => group.source)).toEqual([
        'builtin',
        'user',
        'workspace',
      ])
      expect(groups[0]?.items[0]?.name).toBe('reg-check')
      expect(groups[1]?.items[0]?.name).toBe('trade-clean')
      expect(groups[2]?.items[0]?.name).toBe('fe-debug')
    } finally {
      rmSync(seedDir, { recursive: true, force: true })
      rmSync(userDir, { recursive: true, force: true })
      rmSync(wsRoot, { recursive: true, force: true })
    }
  })

  test('同一来源重复名只保留第一个', () => {
    const userDir = makeRoot()
    try {
      writeSkill(userDir, 'dup-a', {
        name: 'dup',
        title: '第一个',
        description: 'd',
        version: '1',
      })
      writeSkill(userDir, 'dup-b', {
        name: 'dup',
        title: '第二个',
        description: 'd',
        version: '1',
      })
      const catalog = createFsSkillCatalog({
        userRoots: [userDir],
        workspaceRoots: () => [],
      })
      const userGroup = catalog.groups('ws-1')[1]
      expect(userGroup?.items).toHaveLength(1)
      expect(userGroup?.items[0]?.title).toBe('第一个')
    } finally {
      rmSync(userDir, { recursive: true, force: true })
    }
  })

  test('坏 manifest 被跳过并记录诊断，不阻塞其它技能', () => {
    const userDir = makeRoot()
    try {
      writeSkill(userDir, 'bad', { name: 'bad', title: '缺字段' })
      writeSkill(userDir, 'good', {
        name: 'good',
        title: '好技能',
        description: 'd',
        version: '1',
      })
      const catalog = createFsSkillCatalog({
        userRoots: [userDir],
        workspaceRoots: () => [],
      })
      expect(catalog.groups('ws-1')[1]?.items.map((item) => item.name)).toEqual(['good'])
    } finally {
      rmSync(userDir, { recursive: true, force: true })
    }
  })

  test('工作区路径切换后列表刷新（不同 workspaceId 解析不同根目录）', () => {
    const wsARoot = makeRoot()
    const wsBRoot = makeRoot()
    try {
      writeSkill(wsARoot, 'ws-a-skill', {
        name: 'ws-a-skill',
        title: 'A 技能',
        description: 'd',
        version: '1',
      })
      writeSkill(wsBRoot, 'ws-b-skill', {
        name: 'ws-b-skill',
        title: 'B 技能',
        description: 'd',
        version: '1',
      })
      const catalog = createFsSkillCatalog({
        userRoots: [],
        workspaceRoots: (workspaceId) =>
          workspaceId === 'ws-a' ? [wsARoot] : [wsBRoot],
      })
      expect(catalog.groups('ws-a')[2]?.items[0]?.name).toBe('ws-a-skill')
      expect(catalog.groups('ws-b')[2]?.items[0]?.name).toBe('ws-b-skill')
    } finally {
      rmSync(wsARoot, { recursive: true, force: true })
      rmSync(wsBRoot, { recursive: true, force: true })
    }
  })

  test('禁用技能后列表保留但 enabled=false', () => {
    const seedDir = makeRoot()
    const userDir = seededUserRoot(seedDir)
    try {
      writeSkill(seedDir, 'skill-a', {
        name: 'skill-a',
        title: 'A',
        description: 'd',
        version: '1',
      })
      seedBuiltinSkills({ sourceRoots: [seedDir], targetRoot: userDir })
      const catalog = createFsSkillCatalog({
        userRoots: [userDir],
        workspaceRoots: () => [],
      })
      const id = catalog.groups('ws-1')[0]?.items[0]?.id
      expect(id).toBe('builtin:skill-a')
      catalog.setEnabled(id!, false)
      expect(catalog.groups('ws-1')[0]?.items[0]?.enabled).toBe(false)
    } finally {
      rmSync(seedDir, { recursive: true, force: true })
      rmSync(userDir, { recursive: true, force: true })
    }
  })

  test('seed 幂等：已存在不覆盖用户修改，且写入 builtin 标记', () => {
    const seedDir = makeRoot()
    const userDir = makeRoot()
    try {
      writeSkill(seedDir, 'reg-check', {
        name: 'reg-check',
        title: '内置版',
        description: 'd',
        version: '1',
      })
      const first = seedBuiltinSkills({ sourceRoots: [seedDir], targetRoot: userDir })
      expect(first.seeded).toEqual(['reg-check'])

      // 用户修改 seed 进来的技能
      writeFileSync(join(userDir, 'reg-check', 'skill.json'), JSON.stringify({
        name: 'reg-check',
        title: '用户改过的标题',
        description: 'd',
        version: '2',
      }), 'utf8')

      // 再次 seed：跳过，不覆盖
      const second = seedBuiltinSkills({ sourceRoots: [seedDir], targetRoot: userDir })
      expect(second.seeded).toEqual([])
      expect(second.skipped).toEqual(['reg-check'])

      const catalog = createFsSkillCatalog({
        userRoots: [userDir],
        workspaceRoots: () => [],
      })
      const builtinItem = catalog.groups('ws-1')[0]?.items[0]
      expect(builtinItem?.title).toBe('用户改过的标题')
      expect(builtinItem?.version).toBe('2')
    } finally {
      rmSync(seedDir, { recursive: true, force: true })
      rmSync(userDir, { recursive: true, force: true })
    }
  })
})
