import type { AiMessage } from './providers/types';

/**
 * Cheap, provider-agnostic token estimate (≈ 4 characters per token for English, less for CJK/Hebrew
 * where we are deliberately conservative). Used only for budgeting the context window — real usage
 * comes from provider responses.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4 + other / 1.5);
}

/** Per-message framing overhead (role tags, separators). */
const MESSAGE_OVERHEAD_TOKENS = 6;

export function estimateMessageTokens(message: AiMessage): number {
  let total = MESSAGE_OVERHEAD_TOKENS;
  for (const part of message.parts) {
    switch (part.type) {
      case 'text':
        total += estimateTokens(part.text);
        break;
      case 'tool_call':
        total += estimateTokens(part.name) + estimateTokens(JSON.stringify(part.input ?? {}));
        break;
      case 'tool_result':
        total += estimateTokens(typeof part.content === 'string' ? part.content : JSON.stringify(part.content));
        break;
      default:
        break;
    }
  }
  return total;
}

export function estimateMessagesTokens(messages: readonly AiMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}
