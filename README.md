Reference Implementation of Vercel AI SDK Custom Provider
=========================================================

See: https://sdk.vercel.ai/providers/community-providers/custom-providers

Basic usage picks up `REPLICATE_API_TOKEN` from the local environment.

```js
import replicate, { createReplicateProvider } from "./main";
import { streamText } from "ai";

const model = replicate.llm("meta/meta-llama-3-70b-instruct");
const { textStream } = await streamText({
  model,
  prompt: "Write a vegetarian lasagna recipe for 4 people."
});

for await (const textPart of textStream) {
  process.stdout.write(textPart);
}
```

Custom provider can be created with:

```js
const replicate = createReplicateProvider({
  apiKey: 'r8_xyz',
});
```

Additional inputs can be provided to the model:

```js
const model = replicate.llm("meta/meta-llama-3-70b-instruct", {
  extraInput: {
    top_p: 0.8,
    max_tokens: 1024,
  } 
});
```

Prompt and system prompt input names can be customized as well as the transformers:

```js
const model = replicate.llm("meta/meta-llama-3-70b-instruct", {
  promptName: "my_prompt",
  promptTransformer: (p) => p.map(message => {
    if (message.role === "user") {
       return `[INST]${message.content.map(c => c.text).join('')}[\INST]`;
    }
    ...
  }).join(""),
  systemPromptName: "my_system_prompt",
});
```
