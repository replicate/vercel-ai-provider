import { streamText } from "npm:ai";
import process from "npm:process";
import replicate from "./main.ts";

const { textStream } = await streamText({
  model: replicate.llm("meta/meta-llama-3-70b-instruct"),
  prompt: "Write a vegetarian lasagna recipe for 4 people.",
});

for await (const textPart of textStream) {
  process.stdout.write(textPart);
}
