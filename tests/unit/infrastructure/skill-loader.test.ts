import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFsSkillLoader } from '../../../src/infrastructure/skills/index.ts'
import type { SkillManifest } from '../../../src/shared/contracts/skill.ts'

function skillRoot(): { root: string; manifest: SkillManifest } {
  const root = mkdtempSync(join(tmpdir(), 'tgbuddy-skill-load-'))
  mkdirSync(join(root, 'references'), { recursive: true })
  const manifest: SkillManifest = {
    id: 'builtin:reg-check',
    name: 'reg-check',
    title: '监管口径核对',
    description: 'd',
    version: '1.0.0',
    source: 'builtin',
    root,
    enabled: true,
  }
  return { root, manifest }
}

function withSkill(
  run: (fixture: { root: string; manifest: SkillManifest }) => void,
): void {
  const { root, manifest } = skillRoot()
  try {
    run({ root, manifest })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('FsSkillLoader', () => {
  test('按需加载 SKILL.md 正文并给出 token 估算', async () => {
    withSkill(async ({ root, manifest }) => {
      writeFileSync(join(root, 'SKILL.md'), '技能正文：监管口径核对步骤。', 'utf8')
      const loader = createFsSkillLoader()
      const loaded = await loader.loadBody(manifest)
      expect(loaded.text).toContain('监管口径核对步骤')
      expect(loaded.tokens).toBeGreaterThan(0)
    })
  })

  test('相对资源按 skill root 读取', async () => {
    withSkill(async ({ root, manifest }) => {
      writeFileSync(
        join(root, 'references', 'checklist.md'),
        '# 核对清单\n1. 阈值',
        'utf8',
      )
      const loader = createFsSkillLoader()
      const loaded = await loader.loadResource(
        manifest,
        'references/checklist.md',
      )
      expect(loaded.text).toContain('阈值')
    })
  })

  test('越界引用（.. 与绝对路径）被拒绝', async () => {
    withSkill(async ({ root, manifest }) => {
      writeFileSync(join(root, '..', 'outside.txt'), '外部文件', 'utf8')
      const loader = createFsSkillLoader()
      await expect(
        loader.loadResource(manifest, '../outside.txt'),
      ).rejects.toThrow(/越界/)
      await expect(
        loader.loadResource(manifest, root.replace(/[\\/]/, '/') + '/outside.txt'),
      ).rejects.toThrow(/绝对路径|越界/)
    })
  })

  test('缺少正文与缺失资源都抛出可诊断错误', async () => {
    withSkill(async ({ root, manifest }) => {
      const loader = createFsSkillLoader()
      await expect(loader.loadBody(manifest)).rejects.toThrow(/正文/)
      await expect(
        loader.loadResource(manifest, 'missing.md'),
      ).rejects.toThrow(/资源/)
    })
  })
})
