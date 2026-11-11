import type { ToolDefinition as ToolDefinitionDto } from '@hilatech/contracts';
import { zodToJsonSchema } from '../json-schema';

import { stripSchemaMeta } from '../providers/anthropic';
import type { ToolSpec } from '../providers/types';
import type { ToolDefinition } from './types';

/** In-memory catalogue of tool definitions. Built once per process; safe to share. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.key)) throw new Error(`Tool already registered: ${tool.key}`);
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(tool.key)) {
      throw new Error(`Invalid tool key "${tool.key}": use lowercase dotted identifiers`);
    }
    this.tools.set(tool.key, tool);
    return this;
  }

  registerAll(tools: Iterable<ToolDefinition>): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  get(key: string): ToolDefinition | undefined {
    return this.tools.get(key);
  }

  has(key: string): boolean {
    return this.tools.has(key);
  }

  keys(): string[] {
    return [...this.tools.keys()];
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Validate a list of keys (e.g. from an agent definition); returns the unknown ones. */
  unknownKeys(keys: readonly string[]): string[] {
    return keys.filter((k) => !this.tools.has(k));
  }

  /** Model-facing specs for a subset of tools (function names are the tool keys with `.` → `__`). */
  toSpecs(keys: readonly string[]): ToolSpec[] {
    const specs: ToolSpec[] = [];
    for (const key of keys) {
      const tool = this.tools.get(key);
      if (!tool) continue;
      specs.push({
        name: toFunctionName(key),
        description: `${tool.description} (risk: ${tool.riskLevel})`,
        inputSchema: inputJsonSchema(tool),
      });
    }
    return specs;
  }

  /** Public catalogue entries for the UI. */
  toDtos(): ToolDefinitionDto[] {
    return this.list().map((tool) => ({
      key: tool.key,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      riskLevel: tool.riskLevel,
      requiredPermission: tool.requiredPermission,
      inputSchema: inputJsonSchema(tool),
    }));
  }
}

export function inputJsonSchema(tool: ToolDefinition): Record<string, unknown> {
  return stripSchemaMeta(zodToJsonSchema(tool.input));
}

/** Providers restrict function names to `[a-zA-Z0-9_-]`; map dotted keys both ways. */
export function toFunctionName(key: string): string {
  return key.replace(/\./g, '__');
}

export function fromFunctionName(name: string): string {
  return name.replace(/__/g, '.');
}
