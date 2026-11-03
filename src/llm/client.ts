import type { AppConfig } from '../config.js';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmTurn {
  content: string;
  toolCalls: LlmToolCall[];
}

type FetchLike = typeof fetch;

export async function completeChat(options: {
  config: AppConfig;
  messages: unknown[];
  tools?: ToolDefinition[];
  fetchImpl?: FetchLike;
}): Promise<LlmTurn> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.config.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.config.llmApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.config.llmModel,
      temperature: 0.2,
      max_tokens: 400,
      messages: options.messages,
      tools: options.tools && options.tools.length > 0 ? options.tools : undefined,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`El modelo respondió HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown[] } }>;
  };
  const message = payload.choices?.[0]?.message;
  return {
    content: readContent(message?.content),
    toolCalls: readToolCalls(message?.tool_calls),
  };
}

function readContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('');
}

function readToolCalls(value: unknown): LlmToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((call, index) => {
    if (!call || typeof call !== 'object') return [];
    const record = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = typeof record.function?.name === 'string' ? record.function.name : '';
    if (!name) return [];
    const args = record.function?.arguments;
    return [
      {
        id: typeof record.id === 'string' && record.id ? record.id : `call_${index}`,
        name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    ];
  });
}
