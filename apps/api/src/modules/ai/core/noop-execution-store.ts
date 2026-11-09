import { type ExecutionStore } from '@hilatech/ai-engine';

/**
 * Execution store for the interactive assistant: an assistant turn is not an `AgentExecution` row
 * (its transcript is persisted as `AssistantMessage`s and its usage via `UsageRecorder` with the thread
 * id), so steps are not stored and cooperative cancellation is never requested. The assistant has
 * `allowDelegation: false`, so `createChild` is unreachable; it throws to make any regression loud.
 */
export class NoopExecutionStore implements ExecutionStore {
  async markRunning(): Promise<void> {
    // not persisted
  }

  async addStep(): Promise<void> {
    // not persisted
  }

  async finish(): Promise<void> {
    // not persisted
  }

  async createChild(): Promise<{ id: string }> {
    throw new Error('The assistant cannot delegate to agents');
  }

  async isCancelled(): Promise<boolean> {
    return false;
  }
}
