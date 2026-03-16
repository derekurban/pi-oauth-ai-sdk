type AnyRecord = Record<string, unknown>;

type MastraGenerateLike = (input: unknown, options?: AnyRecord) => Promise<unknown>;
type MastraStreamLike = (input: unknown, options?: AnyRecord) => Promise<unknown>;

type MastraCompatAgent = {
  generate: MastraGenerateLike;
  stream: MastraStreamLike;
  listTools(): Promise<Record<string, unknown>>;
  __setTools(tools: Record<string, unknown>): void | Promise<void>;
};

const wrappedAgents = new WeakSet<object>();
const agentMutations = new WeakMap<object, Promise<void>>();

export function withMastraCompat<T extends MastraCompatAgent>(agent: T): T {
  if (wrappedAgents.has(agent as object)) {
    return agent;
  }

  const originalGenerate = agent.generate.bind(agent);
  const originalStream = agent.stream.bind(agent);

  agent.generate = (async (input: unknown, options?: AnyRecord) =>
    runMastraCall(agent, options, (normalizedOptions) => originalGenerate(input, normalizedOptions))) as T["generate"];

  agent.stream = (async (input: unknown, options?: AnyRecord) =>
    runMastraCall(agent, options, (normalizedOptions) => originalStream(input, normalizedOptions))) as T["stream"];

  wrappedAgents.add(agent as object);
  return agent;
}

async function runMastraCall<T>(
  agent: MastraCompatAgent,
  options: AnyRecord | undefined,
  invoke: (normalizedOptions: AnyRecord | undefined) => Promise<T>,
): Promise<T> {
  const normalized = normalizeMastraOptions(options);
  const clientTools = normalized?.clientTools;

  if (!clientTools || !isRecord(clientTools) || Object.keys(clientTools).length === 0) {
    return invoke(normalized);
  }

  return serializeAgentMutation(agent, async () => {
    const originalTools = await agent.listTools();
    const mergedTools = {
      ...originalTools,
      ...clientTools,
    };

    await agent.__setTools(mergedTools);

    try {
      return await invoke(stripClientTools(normalized));
    } finally {
      await agent.__setTools(originalTools);
    }
  });
}

function normalizeMastraOptions(options: AnyRecord | undefined): AnyRecord | undefined {
  if (!options) {
    return options;
  }

  const normalized = { ...options };
  const output = normalized.output;
  const structuredOutput = normalized.structuredOutput;

  if (output !== undefined && (!isRecord(structuredOutput) || structuredOutput.schema === undefined)) {
    normalized.structuredOutput = isRecord(structuredOutput)
      ? { ...structuredOutput, schema: output }
      : { schema: output };
  }

  delete normalized.output;
  return normalized;
}

function stripClientTools(options: AnyRecord | undefined): AnyRecord | undefined {
  if (!options || !("clientTools" in options)) {
    return options;
  }

  const { clientTools: _clientTools, ...rest } = options;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function serializeAgentMutation<T>(agent: object, operation: () => Promise<T>): Promise<T> {
  const previous = agentMutations.get(agent) ?? Promise.resolve();
  let release = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.finally(() => next);

  agentMutations.set(agent, queued);

  await previous;

  try {
    return await operation();
  } finally {
    release();

    if (agentMutations.get(agent) === queued) {
      agentMutations.delete(agent);
    }
  }
}
