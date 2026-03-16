import { describe, expect, it, vi } from "vitest";

import { withMastraCompat } from "./mastra.js";

function createAgentStub() {
  const tools = { existing: { id: "existing-tool" } };
  const generate = vi.fn(async (_input: unknown, options?: Record<string, unknown>) => ({ options }));
  const stream = vi.fn(async (_input: unknown, options?: Record<string, unknown>) => ({ options }));

  const agent = {
    async listTools() {
      return tools;
    },
    __setTools: vi.fn(),
    generate,
    stream,
  };

  return { agent, generate, stream, tools };
}

describe("withMastraCompat", () => {
  it("maps output to structuredOutput for generate calls", async () => {
    const { agent } = createAgentStub();
    const schema = { type: "object" };
    const wrapped = withMastraCompat(agent);

    const result = await wrapped.generate("ping", { output: schema, temperature: 0.2 }) as { options: Record<string, unknown> };

    expect(result.options).toEqual({
      structuredOutput: { schema },
      temperature: 0.2,
    });
  });

  it("preserves an existing structuredOutput shape while filling in a missing schema", async () => {
    const { agent } = createAgentStub();
    const schema = { type: "object" };
    const wrapped = withMastraCompat(agent);

    const result = await wrapped.generate("ping", {
      output: schema,
      structuredOutput: { jsonPromptInjection: true },
    }) as { options: Record<string, unknown> };

    expect(result.options).toEqual({
      structuredOutput: {
        jsonPromptInjection: true,
        schema,
      },
    });
  });

  it("temporarily promotes clientTools into agent tools for generate", async () => {
    const { agent, tools } = createAgentStub();
    const wrapped = withMastraCompat(agent);
    const clientTools = {
      weather: { id: "weather-tool", execute: vi.fn() },
    };

    const result = await wrapped.generate("ping", {
      clientTools,
      maxSteps: 3,
    }) as { options: Record<string, unknown> };

    expect(agent.__setTools).toHaveBeenNthCalledWith(1, {
      ...tools,
      ...clientTools,
    });
    expect(result.options).toEqual({
      maxSteps: 3,
    });
    expect(agent.__setTools).toHaveBeenNthCalledWith(2, tools);
  });

  it("restores original tools after generate errors", async () => {
    const { agent, tools } = createAgentStub();
    const failure = new Error("boom");
    agent.generate = vi.fn(async () => {
      throw failure;
    });
    const wrapped = withMastraCompat(agent);

    await expect(wrapped.generate("ping", {
      clientTools: { weather: { execute: vi.fn() } },
    })).rejects.toThrow("boom");

    expect(agent.__setTools).toHaveBeenNthCalledWith(2, tools);
  });

  it("supports stream calls with the same normalization", async () => {
    const { agent, tools } = createAgentStub();
    const wrapped = withMastraCompat(agent);
    const schema = { type: "object" };
    const clientTools = {
      weather: { id: "weather-tool", execute: vi.fn() },
    };

    const result = await wrapped.stream("ping", {
      output: schema,
      clientTools,
    }) as { options: Record<string, unknown> };

    expect(agent.__setTools).toHaveBeenNthCalledWith(1, {
      ...tools,
      ...clientTools,
    });
    expect(result.options).toEqual({
      structuredOutput: { schema },
    });
    expect(agent.__setTools).toHaveBeenNthCalledWith(2, tools);
  });

  it("wraps an agent only once", async () => {
    const { agent, generate } = createAgentStub();
    const once = withMastraCompat(agent);
    const twice = withMastraCompat(once);

    await twice.generate("ping");

    expect(generate).toHaveBeenCalledTimes(1);
  });
});
