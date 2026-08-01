/** U01：整窗空状态 —— 三个可点击任务样例，点击新建会话并预填草稿。 */
const SAMPLES = [
  {
    title: '梳理工作区',
    desc: '分析当前工作区，告诉我项目结构和主要模块',
    prompt: '分析当前工作区，告诉我项目结构和主要模块',
  },
  {
    title: '排查一个问题',
    desc: '先读代码定位问题，再给出修复方案',
    prompt: '先读代码定位问题，再给出修复方案',
  },
  {
    title: '写一份改进计划',
    desc: '为当前工作区梳理一份实施计划',
    prompt: '为当前工作区梳理一份实施计划',
  },
]

export function SessionSamples({ onPick }: { onPick(prompt: string): void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <div className="text-center">
        <h2 className="text-base font-medium text-foreground">开始一个任务</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          点一个样例新建会话，或直接在新会话里描述目标
        </p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-2">
        {SAMPLES.map((sample) => (
          <button
            key={sample.title}
            type="button"
            data-testid="session-sample"
            onClick={() => onPick(sample.prompt)}
            className="rounded-xl bg-card px-4 py-3 text-left ring-1 ring-border transition-colors hover:bg-accent/40"
          >
            <span className="block text-sm text-foreground">{sample.title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {sample.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
