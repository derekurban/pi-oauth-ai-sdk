import { afterEach, describe, expect, it, vi } from "vitest";
import { generateObject, generateText, stepCountIs, streamObject, streamText, tool } from "ai";
import type { LanguageModelV2, LanguageModelV2StreamPart, LanguageModelV3 } from "@ai-sdk/provider";
import { z } from "zod";

import {
  createAnthropicOAuth,
  createGeminiCliOAuth,
  createOpenAICodexOAuth,
  type OAuthCredentialRecord,
  type OAuthProviderOptions,
} from "../src/index.js";
import { createSseResponse, createTempAuthFile, futureExpiry, readTextStream } from "./helpers.js";

type CapturedRequest = {
  url: string;
  headers: Headers;
  json: Record<string, unknown>;
};

type ProviderCase = {
  name: string;
  providerId: "openai-codex" | "anthropic" | "google-gemini-cli";
  modelId: string;
  credentials: OAuthCredentialRecord;
  create: (options: OAuthProviderOptions) => {
    languageModel(modelId: string): LanguageModelV3;
    languageModelV2(modelId: string): LanguageModelV2;
  };
  textResponse: (text: string) => Response;
  toolCallResponse: (toolName: string, input: Record<string, unknown>) => Response;
  assertBasicRequest: (request: CapturedRequest) => void;
  assertJsonRequest: (request: CapturedRequest) => void;
  assertToolResultRequest: (request: CapturedRequest) => void;
};

const providerCases: ProviderCase[] = [
  {
    name: "OpenAI Codex OAuth",
    providerId: "openai-codex",
    modelId: "gpt-5.4",
    credentials: {
      type: "oauth",
      access: "codex-access-token",
      refresh: "codex-refresh-token",
      expires: futureExpiry(),
      accountId: "acct_test",
    },
    create: createOpenAICodexOAuth,
    textResponse: (text) => createSseResponse([
      { data: { type: "response.output_item.added", item: { type: "message" } } },
      { data: { type: "response.output_text.delta", delta: text.slice(0, Math.max(1, Math.floor(text.length / 2))) } },
      { data: { type: "response.output_text.delta", delta: text.slice(Math.max(1, Math.floor(text.length / 2))) } },
      { data: { type: "response.output_item.done", item: { type: "message", id: "msg_1", content: [{ type: "output_text", text }] } } },
      {
        data: {
          type: "response.completed",
          response: {
            id: "resp_codex",
            status: "completed",
            usage: {
              input_tokens: 12,
              output_tokens: 6,
              total_tokens: 18,
              input_tokens_details: { cached_tokens: 0 },
            },
          },
        },
      },
    ]),
    toolCallResponse: (toolName, input) => createSseResponse([
      {
        data: {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            call_id: "call_weather",
            id: "fc_weather",
            name: toolName,
            arguments: "{}",
          },
        },
      },
      {
        data: {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            call_id: "call_weather",
            id: "fc_weather",
            name: toolName,
            arguments: JSON.stringify(input),
          },
        },
      },
      {
        data: {
          type: "response.completed",
          response: {
            id: "resp_codex_tool",
            status: "completed",
            usage: {
              input_tokens: 14,
              output_tokens: 3,
              total_tokens: 17,
              input_tokens_details: { cached_tokens: 0 },
            },
          },
        },
      },
    ]),
    assertBasicRequest: (request) => {
      expect(request.url).toContain("/codex/responses");
      expect(request.headers.get("authorization")).toBe("Bearer codex-access-token");
      expect(request.headers.get("chatgpt-account-id")).toBe("acct_test");
      expect(request.json.instructions).toBe("You are a helpful assistant.");
      expect(request.json.model).toBe("gpt-5.4");
    },
    assertJsonRequest: (request) => {
      expect(String(request.json.instructions)).toContain("Return only valid JSON.");
    },
    assertToolResultRequest: (request) => {
      const input = request.json.input as Array<Record<string, unknown>>;
      expect(input.some((entry) => {
        const output = String(entry.output ?? "");
        return entry.type === "function_call_output" && output.includes("clear-skies-for-calgary");
      })).toBe(true);
    },
  },
  {
    name: "Anthropic OAuth",
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    credentials: {
      type: "oauth",
      access: "anthropic-access-token",
      refresh: "anthropic-refresh-token",
      expires: futureExpiry(),
    },
    create: createAnthropicOAuth,
    textResponse: (text) => createSseResponse([
      { event: "message_start", data: { message: { id: "msg_anthropic", usage: { input_tokens: 10, output_tokens: 0 } } } },
      { event: "content_block_start", data: { index: 0, content_block: { type: "text", text: "" } } },
      { event: "content_block_delta", data: { index: 0, delta: { type: "text_delta", text: text.slice(0, Math.max(1, Math.floor(text.length / 2))) } } },
      { event: "content_block_delta", data: { index: 0, delta: { type: "text_delta", text: text.slice(Math.max(1, Math.floor(text.length / 2))) } } },
      { event: "content_block_stop", data: { index: 0 } },
      { event: "message_delta", data: { delta: { stop_reason: "end_turn" }, usage: { input_tokens: 10, output_tokens: 6 } } },
      { event: "message_stop", data: {} },
    ]),
    toolCallResponse: (toolName, input) => createSseResponse([
      { event: "message_start", data: { message: { id: "msg_anthropic_tool", usage: { input_tokens: 12, output_tokens: 0 } } } },
      {
        event: "content_block_start",
        data: {
          index: 0,
          content_block: {
            type: "tool_use",
            id: "call_weather",
            name: toolName,
            input: {},
          },
        },
      },
      { event: "content_block_delta", data: { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } } },
      { event: "content_block_stop", data: { index: 0 } },
      { event: "message_delta", data: { delta: { stop_reason: "tool_use" }, usage: { input_tokens: 12, output_tokens: 2 } } },
      { event: "message_stop", data: {} },
    ]),
    assertBasicRequest: (request) => {
      expect(request.url).toBe("https://api.anthropic.com/v1/messages");
      expect(request.headers.get("authorization")).toBe("Bearer anthropic-access-token");
      expect(request.headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
      const system = request.json.system as Array<{ text: string }>;
      expect(system[0]?.text).toContain("Claude Code");
    },
    assertJsonRequest: (request) => {
      const system = request.json.system as Array<{ text: string }>;
      expect(system.some((entry) => entry.text.includes("Return only valid JSON."))).toBe(true);
    },
    assertToolResultRequest: (request) => {
      const messages = request.json.messages as Array<Record<string, unknown>>;
      expect(messages.some((entry) => {
        const content = entry.content as Array<Record<string, unknown>>;
        return entry.role === "user" && Array.isArray(content)
          && content.some((part) => part.type === "tool_result" && String(part.content ?? "").includes("clear-skies-for-calgary"));
      })).toBe(true);
    },
  },
  {
    name: "Gemini CLI OAuth",
    providerId: "google-gemini-cli",
    modelId: "gemini-2.5-pro",
    credentials: {
      type: "oauth",
      access: "gemini-access-token",
      refresh: "gemini-refresh-token",
      expires: futureExpiry(),
      projectId: "test-project",
    },
    create: createGeminiCliOAuth,
    textResponse: (text) => createSseResponse([
      {
        data: {
          response: {
            candidates: [{
              content: { role: "model", parts: [{ text: text.slice(0, Math.max(1, Math.floor(text.length / 2))) }] },
            }],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 0,
              thoughtsTokenCount: 0,
              totalTokenCount: 10,
            },
          },
        },
      },
      {
        data: {
          response: {
            candidates: [{
              content: { role: "model", parts: [{ text: text.slice(Math.max(1, Math.floor(text.length / 2))) }] },
              finishReason: "STOP",
            }],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 6,
              thoughtsTokenCount: 0,
              totalTokenCount: 16,
            },
            responseId: "resp_gemini",
          },
        },
      },
    ]),
    toolCallResponse: (toolName, input) => createSseResponse([
      {
        data: {
          response: {
            candidates: [{
              content: {
                role: "model",
                parts: [{
                  functionCall: {
                    name: toolName,
                    args: input,
                    id: "call_weather",
                  },
                }],
              },
              finishReason: "STOP",
            }],
            usageMetadata: {
              promptTokenCount: 12,
              candidatesTokenCount: 2,
              thoughtsTokenCount: 0,
              totalTokenCount: 14,
            },
            responseId: "resp_gemini_tool",
          },
        },
      },
    ]),
    assertBasicRequest: (request) => {
      expect(request.url).toContain("streamGenerateContent");
      expect(request.headers.get("authorization")).toBe("Bearer gemini-access-token");
      expect(request.json.project).toBe("test-project");
      expect(request.json.model).toBe("gemini-2.5-pro");
    },
    assertJsonRequest: (request) => {
      const systemInstruction = request.json.request as { systemInstruction?: { parts: Array<{ text: string }> } };
      expect(systemInstruction.systemInstruction?.parts[0]?.text).toContain("Return only valid JSON.");
    },
    assertToolResultRequest: (request) => {
      const contents = (request.json.request as { contents: Array<Record<string, unknown>> }).contents;
      expect(contents.some((entry) => {
        const parts = entry.parts as Array<Record<string, unknown>>;
        return entry.role === "user" && Array.isArray(parts)
          && parts.some((part) => {
            const functionResponse = part.functionResponse as Record<string, unknown> | undefined;
            return functionResponse?.id === "call_weather";
          });
      })).toBe(true);
    },
  },
];

function captureFetch(responses: Response[], calls: CapturedRequest[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No mocked response left for fetch");
    }

    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      json: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
    });

    return next;
  });
}

async function readV2Stream(stream: ReadableStream<LanguageModelV2StreamPart>) {
  const reader = stream.getReader();
  let text = "";
  let sawStreamStart = false;
  let finishReason: string | undefined;
  let warnings: Array<{ type: string }> = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      switch (value.type) {
        case "stream-start":
          sawStreamStart = true;
          warnings = value.warnings as Array<{ type: string }>;
          break;
        case "text-delta":
          text += value.delta;
          break;
        case "finish":
          finishReason = value.finishReason;
          break;
        default:
          break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text, sawStreamStart, finishReason, warnings };
}

describe.each(providerCases)("$name", (providerCase) => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  function createProvider(responses: Response[]) {
    const calls: CapturedRequest[] = [];
    const fetch = captureFetch(responses, calls);
    const { authFile, cleanup } = createTempAuthFile(providerCase.providerId, providerCase.credentials);
    cleanups.push(cleanup);
    const provider = providerCase.create({ authFile, fetch });
    return { provider, fetch, calls };
  }

  it("supports generateText", async () => {
    const { provider, calls } = createProvider([providerCase.textResponse("pong")]);

    const result = await generateText({
      model: provider.languageModel(providerCase.modelId),
      prompt: "Reply with exactly pong",
    });

    expect(result.text).toBe("pong");
    expect(calls).toHaveLength(1);
    providerCase.assertBasicRequest(calls[0]!);
  });

  it("supports languageModelV2 doGenerate", async () => {
    const { provider, calls } = createProvider([providerCase.textResponse("pong-v2")]);

    const result = await provider.languageModelV2(providerCase.modelId).doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Reply with exactly pong-v2" }] }],
    });

    expect(result.content).toEqual([{ type: "text", text: "pong-v2" }]);
    expect(result.finishReason).toBe("stop");
    expect(result.response?.modelId).toBe(providerCase.modelId);
    expect(result.warnings).toEqual([]);
    expect(calls).toHaveLength(1);
    providerCase.assertBasicRequest(calls[0]!);
  });

  it("supports streamText", async () => {
    const { provider } = createProvider([providerCase.textResponse("stream-pong")]);

    const result = await streamText({
      model: provider.languageModel(providerCase.modelId),
      prompt: "Reply with exactly stream-pong",
    });

    const text = await readTextStream(result.textStream);
    expect(text).toBe("stream-pong");
  });

  it("supports languageModelV2 doStream with compatibility warnings", async () => {
    const { provider, calls } = createProvider([providerCase.textResponse("{\"status\":\"ok\",\"code\":9}")]);

    const result = await provider.languageModelV2(providerCase.modelId).doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Return a JSON object." }] }],
      responseFormat: { type: "json", schema: { type: "object" } },
      ...(providerCase.providerId === "openai-codex" ? { temperature: 0.7 } : {}),
      ...(providerCase.providerId === "google-gemini-cli"
        ? {
          tools: [{
            type: "function" as const,
            name: "weather",
            description: "Returns weather.",
            inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          }],
          toolChoice: { type: "required" as const },
        }
        : {}),
    });

    const streamed = await readV2Stream(result.stream);

    expect(streamed.sawStreamStart).toBe(true);
    expect(streamed.text).toBe("{\"status\":\"ok\",\"code\":9}");
    expect(streamed.finishReason).toBe("stop");
    expect(streamed.warnings.some((warning) => warning.type === "other")).toBe(true);

    if (providerCase.providerId === "openai-codex") {
      expect(streamed.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "unsupported-setting", setting: "temperature" }),
      ]));
    }

    if (providerCase.providerId === "google-gemini-cli") {
      expect(streamed.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "unsupported-setting", setting: "toolChoice" }),
      ]));
    }

    providerCase.assertJsonRequest(calls[0]!);
  });

  it("supports generateObject via compatibility JSON mode", async () => {
    const { provider, calls } = createProvider([providerCase.textResponse("{\"status\":\"ok\",\"code\":7}")]);

    const result = await generateObject({
      model: provider.languageModel(providerCase.modelId),
      prompt: "Return an object with status ok and code 7.",
      schema: z.object({
        status: z.string(),
        code: z.number(),
      }),
      schemaName: "statusPayload",
      schemaDescription: "Simple status payload",
    });

    expect(result.object).toEqual({ status: "ok", code: 7 });
    providerCase.assertJsonRequest(calls[0]!);
  });

  it("supports streamObject via compatibility JSON mode", async () => {
    const { provider } = createProvider([providerCase.textResponse("{\"status\":\"ok\",\"code\":8}")]);

    const result = await streamObject({
      model: provider.languageModel(providerCase.modelId),
      prompt: "Return an object with status ok and code 8.",
      schema: z.object({
        status: z.string(),
        code: z.number(),
      }),
    });

    const partials: Array<Record<string, unknown>> = [];
    for await (const partial of result.partialObjectStream) {
      partials.push(partial as Record<string, unknown>);
    }

    expect(await result.object).toEqual({ status: "ok", code: 8 });
    expect(partials.length).toBeGreaterThan(0);
  });

  it("supports tool calling across multiple turns", async () => {
    const { provider, calls } = createProvider([
      providerCase.toolCallResponse("weather", { city: "Calgary" }),
      providerCase.textResponse("clear-skies-for-calgary"),
    ]);

    const result = await generateText({
      model: provider.languageModel(providerCase.modelId),
      prompt: "Use the weather tool for Calgary, then answer with the forecast only.",
      stopWhen: stepCountIs(3),
      tools: {
        weather: tool({
          description: "Returns a canned forecast for a city.",
          inputSchema: z.object({
            city: z.string(),
          }),
          execute: async ({ city }) => ({ forecast: `clear-skies-for-${city.toLowerCase()}` }),
        }),
      },
    });

    expect(result.text).toBe("clear-skies-for-calgary");
    expect(calls).toHaveLength(2);
    providerCase.assertToolResultRequest(calls[1]!);
  });

  it("emits compatibility warnings for JSON mode and rejects aborted requests", async () => {
    const abortedCalls: CapturedRequest[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      abortedCalls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        json: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
      });
      if (init?.signal?.aborted) {
        const error = new Error("Request was aborted");
        error.name = "AbortError";
        throw error;
      }
      return providerCase.textResponse("{\"status\":\"ok\"}");
    });

    const { authFile, cleanup } = createTempAuthFile(providerCase.providerId, providerCase.credentials);
    cleanups.push(cleanup);
    const provider = providerCase.create({ authFile, fetch });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.languageModel(providerCase.modelId).doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Return json" }] }],
      responseFormat: { type: "json", schema: { type: "object" } },
      ...(providerCase.providerId === "openai-codex" ? { temperature: 0.7 } : {}),
      abortSignal: controller.signal,
    })).rejects.toThrow();

    expect(abortedCalls).toHaveLength(1);
  });
});
