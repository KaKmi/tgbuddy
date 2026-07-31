import type { AskUserQuestion } from '../../shared/types/permission.ts'

/**
 * 取单个问题的答案：优先自定义输入，其次已选选项。
 * 注意：选中选项时组件会把 custom 对应项清成空串，空串必须视为「未自定义」，
 * 否则 `??` 不会回退到选项答案，导致「选了选项却无法提交」。
 */
export function resolveAskUserAnswer(
  questionId: string,
  custom: Record<string, string>,
  answers: Record<string, string>,
): string {
  const customText = custom[questionId]?.trim() ?? ''
  if (customText !== '') return customText
  return answers[questionId]?.trim() ?? ''
}

/** 所有问题都有有效答案时才允许提交 */
export function isAskUserComplete(
  questions: AskUserQuestion[],
  custom: Record<string, string>,
  answers: Record<string, string>,
): boolean {
  return questions.every(
    (question) => resolveAskUserAnswer(question.id, custom, answers) !== '',
  )
}
