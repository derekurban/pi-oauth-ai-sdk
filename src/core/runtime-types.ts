import type { SharedV3Warning } from "@ai-sdk/provider";

import type { OAuthProviderId } from "../types.js";

export type TransportApi = "openai-codex-responses" | "anthropic-messages" | "google-gemini-cli";

export type RuntimeStopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface RuntimeUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface RuntimeTextPart {
  type: "text";
  text: string;
}

export interface RuntimeReasoningPart {
  type: "thinking";
  thinking: string;
}

export interface RuntimeToolCallPart {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type RuntimeAssistantContent = RuntimeTextPart | RuntimeReasoningPart | RuntimeToolCallPart;

export interface RuntimeUserTextPart {
  type: "text";
  text: string;
}

export interface RuntimeUserMessage {
  role: "user";
  content: string | RuntimeUserTextPart[];
}

export interface RuntimeAssistantPromptMessage {
  role: "assistant";
  content: RuntimeAssistantContent[];
}

export interface RuntimeToolResultTextPart {
  type: "text";
  text: string;
}

export interface RuntimeToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: RuntimeToolResultTextPart[];
  isError: boolean;
}

export type RuntimeMessage = RuntimeUserMessage | RuntimeAssistantPromptMessage | RuntimeToolResultMessage;

export interface RuntimeToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export type RuntimeToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" }
  | { type: "tool"; toolName: string };

export type RuntimeResponseFormat =
  | { type: "text" }
  | { type: "json"; schema?: unknown; instruction: string };

export interface RuntimeContext {
  systemPrompt?: string;
  messages: RuntimeMessage[];
  tools?: RuntimeToolDefinition[];
  toolChoice?: RuntimeToolChoice;
  responseFormat: RuntimeResponseFormat;
}

export interface RuntimeCallSettings {
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface PreparedRuntimeCall<TWarning = SharedV3Warning> {
  context: RuntimeContext;
  settings: RuntimeCallSettings;
  warnings: TWarning[];
}

export interface RuntimeAssistantMessage {
  role: "assistant";
  api: TransportApi;
  provider: OAuthProviderId;
  model: string;
  content: RuntimeAssistantContent[];
  usage: RuntimeUsage;
  stopReason: RuntimeStopReason;
  timestamp: number;
  responseId?: string | undefined;
}

export type RuntimeStreamEvent =
  | { type: "start"; partial: RuntimeAssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: RuntimeAssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: RuntimeAssistantMessage }
  | { type: "text_end"; contentIndex: number; partial: RuntimeAssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: RuntimeAssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: RuntimeAssistantMessage }
  | { type: "thinking_end"; contentIndex: number; partial: RuntimeAssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: RuntimeAssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: RuntimeAssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: RuntimeToolCallPart; partial: RuntimeAssistantMessage }
  | { type: "done"; reason: RuntimeStopReason; message: RuntimeAssistantMessage }
  | { type: "error"; reason: RuntimeStopReason; error: RuntimeAssistantMessage };
