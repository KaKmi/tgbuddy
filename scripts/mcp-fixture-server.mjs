/**
 * 最小 MCP stdio 测试服务（E2E/dev 验证用）。
 * 新行分隔 JSON-RPC：支持 initialize / tools/list / tools/call(echo)。
 */

process.stdin.setEncoding('utf8')

let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      sendError(null, -32700, 'parse error')
      continue
    }
    void handle(message)
  }
})

process.stdin.on('end', () => {
  process.exit(0)
})

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(message) {
  const id = message.id ?? null
  switch (message.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'tgbuddy-echo', version: '0.0.1' },
        },
      })
      return
    case 'notifications/initialized':
      return
    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'echo',
              description: '回显输入文本',
              inputSchema: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: '要回显的内容' },
                },
                required: ['text'],
              },
            },
          ],
        },
      })
      return
    case 'tools/call': {
      const text = message.params?.arguments?.text ?? ''
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `echo:${text}` }],
          isError: false,
        },
      })
      return
    }
    default:
      sendError(id, -32601, `unknown method: ${message.method}`)
  }
}
