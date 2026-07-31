import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillManifest } from '../../../src/shared/contracts/skill.ts'
import { createFsSkillLoader } from '../../../src/infrastructure/skills/index.ts'
import { buildSkillTool } from '../../../src/kernel/pi/pi-skill-tool.ts'

function makeSkill(name: string, body: string): SkillManifest {
  const root = mkdtempSync(join(tmpdir(), `tgbuddy-skill-tool-${name}-`))
  mkdirSync(join(root, 'references'), { recursive: true })
  writeFileSync(join(root, 'SKILL.md'), body, 'utf8')
  writeFileSync(join(root, 'references', 'detail.md'), `${name} 的引用资源`, 'utf8')
  return {
    id: `builtin:${name}`,
    name,
    title: name,
    description: `描述 ${name}`,
    version: '1.0.0',
    source: 'builtin',
    root,
    enabled: true,
  }
}

describe('skill 工具（pi adapter）', () => {
  test('按名称加载技能正文，返回真实内容', async () => {
    const skills = [makeSkill('reg-check', '技能正文 A'), makeSkill('fe-debug', '技能正文 B')]
    try {
      const tool = buildSkillTool({
        skills,
        loader: createFsSkillLoader(),
      })
      const result = await tool.execute(
        'call-1',
        { skill: 'reg-check' },
        new AbortController().signal,
        () => {},
      )
      expect(result.content[0]).toMatchObject({ type: 'text', text: '技能正文 A' })
    } finally {
      for (const skill of skills) rmSync(skill.root, { recursive: true, force: true })
    }
  })

  test('resource 参数按相对路径读取引用资源', async () => {
    const skills = [makeSkill('reg-check', '正文')]
    try {
      const tool = buildSkillTool({
        skills,
        loader: createFsSkillLoader(),
      })
      const result = await tool.execute(
        'call-2',
        { skill: 'reg-check', resource: 'references/detail.md' },
        new AbortController().signal,
        () => {},
      )
      expect(result.content[0]).toMatchObject({
        type: 'text',
        text: 'reg-check 的引用资源',
      })
    } finally {
      for (const skill of skills) rmSync(skill.root, { recursive: true, force: true })
    }
  })

  test('未知或未启用技能抛出可诊断错误', async () => {
    const skills = [makeSkill('reg-check', '正文')]
    try {
      const tool = buildSkillTool({
        skills,
        loader: createFsSkillLoader(),
      })
      await expect(
        tool.execute(
          'call-3',
          { skill: 'not-exist' },
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow(/技能不存在/)
    } finally {
      for (const skill of skills) rmSync(skill.root, { recursive: true, force: true })
    }
  })

  test('正文修改只影响下一 Run：工具持有的技能列表是启动时冻结的', async () => {
    const skills = [makeSkill('reg-check', '第一版正文')]
    try {
      const tool = buildSkillTool({
        skills,
        loader: createFsSkillLoader(),
      })
      // 运行中把技能改名/移除，冻结列表不变
      const frozen = skills[0]!
      skills.length = 0
      const result = await tool.execute(
        'call-4',
        { skill: frozen.name },
        new AbortController().signal,
        () => {},
      )
      expect(result.content[0]).toMatchObject({ type: 'text', text: '第一版正文' })
    } finally {
      for (const skill of skills) rmSync(skill.root, { recursive: true, force: true })
    }
  })
})
