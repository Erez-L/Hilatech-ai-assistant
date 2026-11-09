// Errors
export {
  AiNotConfiguredError,
  AiProviderError,
  LimitExceededError,
  ToolDeniedError,
  codeFromStatus,
  type AiErrorCode,
  type LimitKind,
} from './errors';

// Tokens & context
export { estimateMessageTokens, estimateMessagesTokens, estimateTokens } from './tokens';
export {
  buildContext,
  dataBlock,
  truncateForContext,
  type ContextBuildInput,
  type ContextBuildResult,
} from './context/context-builder';

// Prompts
export {
  buildSystemPrompt,
  extractVariables,
  renderTemplate,
  type RenderOptions,
  type SystemPromptParts,
  type TemplateVariables,
} from './prompts/render';

// Providers
export type {
  AiMessage,
  AiPart,
  AiProvider,
  AiRole,
  EmbedRequest,
  EmbedResult,
  FinishReason,
  GenerateRequest,
  GenerateResult,
  HealthResult,
  ProviderCredentials,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
  TextPart,
  TokenUsage,
  ToolCall,
  ToolCallPart,
  ToolChoice,
  ToolResultPart,
  ToolSpec,
} from './providers/types';
export { messageText, text } from './providers/types';
export { AnthropicProvider, toAnthropicMessages, stripSchemaMeta } from './providers/anthropic';
export { OpenAiProvider, toOpenAiMessages } from './providers/openai';
export { MockProvider, type MockProviderOptions, type MockTurn } from './providers/mock';
export { createProvider, requiresApiKey, type CreateProviderOptions } from './providers/factory';
export {
  DEFAULT_CONTEXT_WINDOW,
  contextWindowFor,
  findModel,
  listModels,
} from './providers/models';

// Tools
export type {
  EngineLogger,
  ToolContext,
  ToolDefinition,
  ToolPrincipal,
  ToolResult,
} from './tools/types';
export { noopLogger } from './tools/types';
export { ToolRegistry, fromFunctionName, inputJsonSchema, toFunctionName } from './tools/registry';
export {
  ToolExecutor,
  outcomeToModelContent,
  type ToolExecutorOptions,
  type ToolOutcome,
} from './tools/executor';
export { crmTools } from './tools/builtin/crm';
export {
  createKnowledgeSearchTool,
  timeNowTool,
  type KnowledgeSearcher,
} from './tools/builtin/utility';

// Orchestrator
export { AgentRunner, effectiveLimits, toolFunctionName } from './orchestrator/runner';
export type {
  AgentDefinition,
  Budget,
  ExecutionFinish,
  ExecutionStore,
  ResolvedModel,
  RunEvent,
  RunRequest,
  RunResult,
  RunStatus,
  RunnerDeps,
  StepRecord,
  UsageEntry,
  UsageRecorder,
} from './orchestrator/types';

// Usage
export {
  PricingTable,
  pricingEntrySchema,
  pricingTableSchema,
  type PricingEntry,
} from './usage/pricing';

/** Tool keys the interactive assistant may use by default (read + safe write CRM actions). */
export const ASSISTANT_DEFAULT_TOOLS: readonly string[] = [
  'time.now',
  'crm.search_contacts',
  'crm.get_contact',
  'crm.create_contact',
  'crm.search_leads',
  'crm.get_lead',
  'crm.create_lead',
  'crm.update_lead_status',
  'crm.add_lead_note',
  'crm.list_conversations',
  'crm.get_conversation_messages',
  'knowledge.search',
];
