/**
 * Minimal OpenAI streaming client.
 *
 * We use the Chat Completions endpoint with `stream: true`. OpenAI returns
 * Server-Sent Events: lines that start with `data: ` carrying JSON, ending
 * with `data: [DONE]`. We parse those incrementally and call `onToken` for
 * every text delta.
 *
 * Docs: https://platform.openai.com/docs/api-reference/chat/create
 */

const DEFAULT_MODEL = "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

function getKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

/**
 * Streams an OpenAI chat completion. Calls `onToken(text)` for each delta
 * chunk; resolves with the full text + the model id when the stream ends.
 *
 * @param {{
 *   system: string,
 *   user: string,
 *   model?: string,
 *   onToken: (text: string) => void,
 *   maxTokens?: number,
 *   temperature?: number,
 * }} opts
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function streamChat({
  system,
  user,
  model,
  onToken,
  maxTokens = 600,
  temperature = 0.2,
}) {
  const modelId = model || process.env.LLM_MODEL || DEFAULT_MODEL;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getKey()}`,
    },
    body: JSON.stringify({
      model: modelId,
      stream: true,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI chat failed (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    // SSE frames are line-based; keep the trailing partial line in buffer.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        return { text: full, model: modelId };
      }
      try {
        const json = JSON.parse(data);
        const token = json.choices?.[0]?.delta?.content;
        if (token) {
          full += token;
          onToken(token);
        }
      } catch {
        // Skip malformed frames silently.
      }
    }
  }

  return { text: full, model: modelId };
}
