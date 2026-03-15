import { NoSuchModelError } from "@ai-sdk/provider";
import { getModel, getModels, type Api, type Model } from "@mariozechner/pi-ai";
import { getOAuthProvider, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";

import type { PiOAuthProviderId } from "../types.js";

export function resolvePiModel(
  providerId: PiOAuthProviderId,
  modelId: string,
  credentials: OAuthCredentials,
): Model<Api> {
  const resolved = tryGetModel(providerId, modelId) ?? makeTemplateModel(providerId, modelId);
  return applyOAuthModelModifiers(providerId, resolved, credentials);
}

function tryGetModel(providerId: PiOAuthProviderId, modelId: string): Model<Api> | undefined {
  try {
    return getModel(providerId as never, modelId as never) as Model<Api> | undefined;
  } catch {
    return undefined;
  }
}

function makeTemplateModel(providerId: PiOAuthProviderId, modelId: string): Model<Api> {
  const templates = getModels(providerId as never) as Model<Api>[];
  const template = templates[0];
  if (!template) {
    throw new NoSuchModelError({
      modelId,
      modelType: "languageModel",
      message: `No models are registered for provider '${providerId}'.`,
    });
  }

  return {
    ...template,
    id: modelId,
    name: modelId,
  };
}

function applyOAuthModelModifiers(
  providerId: PiOAuthProviderId,
  model: Model<Api>,
  credentials: OAuthCredentials,
): Model<Api> {
  const oauthProvider = getOAuthProvider(providerId);
  if (!oauthProvider?.modifyModels) {
    return model;
  }

  const modified = oauthProvider.modifyModels([model], credentials);
  return modified[0] ?? model;
}
