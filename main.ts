import type {
  LanguageModelV1,
  LanguageModelV1StreamPart,
  LanguageModelV1Prompt,
} from "npm:@ai-sdk/provider";
import {
  loadApiKey,
  postJsonToApi,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
} from "npm:@ai-sdk/provider-utils";
import { z } from "npm:zod";
import {
  EventSourceParserStream,
  ParsedEvent,
} from "npm:eventsource-parser/stream";

const REPLICATE_API_TOKEN = loadApiKey({
  apiKey: undefined,
  environmentVariableName: "REPLICATE_API_TOKEN",
  apiKeyParameterName: "REPLICATE_API_TOKEN",
  description: "Replicate",
});

export type ReplicateModelId =
  | `${string}/${string}`
  | `${string}/${string}:${string}`;

export interface ReplicateModelSettings {
  promptName?: string;
  promptTransformer?: (prompt: LanguageModelV1Prompt) => string;
  systemPromptName?: string;
  systemPromptTransformer?: (prompt: LanguageModelV1Prompt) => string;
  extraInput?: Record<string, unknown>;
}

export interface ReplicateProviderSettings {
  apiKey: string;
}

const schema = {
  prediction: z.object({
    output: z.nullable(z.array(z.string())),
    urls: z.object({
      stream: z.string(),
    }),
  }),
  stream: z.string(),
  error: z.object({
    detail: z.string(),
  }),
};

function parseModelId(ref: ReplicateModelId): {
  owner: string;
  name: string;
  version?: string;
} {
  const match = ref.match(
    /^(?<owner>[^/]+)\/(?<name>[^/:]+)(:(?<version>.+))?$/,
  );
  if (!match || !match.groups) {
    throw new Error(
      `Invalid reference to model version: ${ref}. Expected format: owner/name or owner/name:version`,
    );
  }

  const { owner, name, version } = match.groups;
  return { owner, name, version };
}

export function createReplicateProvider({ apiKey }: ReplicateProviderSettings) {
  function createLanguageModel(
    modelId: ReplicateModelId,
    settings: ReplicateModelSettings = {},
  ): LanguageModelV1 {
    return {
      specificationVersion: "v1",
      provider: "replicate",
      modelId,
      defaultObjectGenerationMode: undefined,
      async doGenerate({ inputFormat: _, prompt, mode: __ }) {
        const stream = await makeLanguageModelPrediction({
          modelId,
          apiKey,
          settings,
          prompt,
        });

        const output: string[] = [];
        for await (const part of stream) {
          if (part.type === "text-delta") {
            output.push(part.textDelta);
            continue;
          }
          break;
        }

        return {
          text: output.join(""),
          finishReason: "stop",
          usage: {
            promptTokens: 0,
            completionTokens: 0,
          },
          rawCall: {
            rawPrompt: prompt,
            rawSettings: settings as Record<string, unknown>,
          },
        };
      },
      async doStream({ prompt, inputFormat: _, mode: __ }) {
        const stream = await makeLanguageModelPrediction({
          modelId,
          apiKey,
          settings,
          prompt,
        });

        return {
          stream,
          rawCall: {
            rawPrompt: prompt,
            rawSettings: settings as Record<string, unknown>,
          },
        };
      },
    };
  }

  return {
    llm: createLanguageModel,
  };
}

export default createReplicateProvider({
  apiKey: REPLICATE_API_TOKEN,
});

async function makeLanguageModelPrediction({
  modelId,
  apiKey,
  prompt,
  settings,
}: {
  modelId: ReplicateModelId;
  apiKey: string;
  prompt: LanguageModelV1Prompt;
  settings: ReplicateModelSettings;
}): Promise<ReadableStream<LanguageModelV1StreamPart>> {
  const transformer = settings.promptTransformer ?? transformPrompt;
  const transformedPrompt = transformer(prompt);

  const systemPromptTransformer =
    settings.promptTransformer ?? transformSystemPrompt;
  const transformedSystemPrompt = systemPromptTransformer(prompt);

  const { owner, name, version } = parseModelId(modelId);
  let path = `/v1/models/${owner}/${name}/predictions`;
  if (version) {
    path = "/v1/predictions";
  }

  const body = {
    ...(version ? { version } : {}),
    input: {
      ...settings.extraInput,
      [settings.promptName ?? "prompt"]: transformedPrompt,
      ...(transformedSystemPrompt
        ? {
            [settings.systemPromptName ?? "system_prompt"]:
              transformedSystemPrompt,
          }
        : undefined),
    },
  };

  const { value: prediction } = await postJsonToApi<
    z.infer<typeof schema.prediction>
  >({
    url: `https://api.replicate.com${path}`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
    successfulResponseHandler: createJsonResponseHandler(schema.prediction),
    failedResponseHandler: createJsonErrorResponseHandler<
      z.infer<typeof schema.error>
    >({
      errorSchema: schema.error,
      errorToMessage: (error) => error.detail,
    }),
  });

  const response = await fetch(prediction.urls.stream, {
    headers: {
      Accept: "text/event-stream",
    },
  });
  if (!response.body) {
    throw new Error("Missing response body");
  }

  return response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .pipeThrough(
      new TransformStream<ParsedEvent, LanguageModelV1StreamPart>({
        transform({ data, event }, controller) {
          if (event === "done") {
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: {
                promptTokens: 0,
                completionTokens: 0,
              },
            });
            controller.terminate();
            return;
          }

          if (event === "output") {
            controller.enqueue({
              type: "text-delta",
              textDelta: data,
            });
          }
        },
      }),
    );
}

function transformPrompt(prompt: LanguageModelV1Prompt): string {
  const parts = [];
  for (const message of prompt) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      parts.push(
        message.content.filter((c) => c.type === "text").map((c) => c.text),
      );
    }
    if (message.role === "assistant") {
      parts.push(
        message.content.filter((c) => c.type === "text").map((c) => c.text),
      );
    }
    if (message.role === "tool") {
      continue;
    }
  }
  return parts.join("");
}

function transformSystemPrompt(
  prompt: LanguageModelV1Prompt,
): string | undefined {
  const parts = [];
  for (const message of prompt) {
    if (message.role === "system") {
      parts.push(message.content);
    }
  }
  return parts.length ? parts.join("") : undefined;
}
