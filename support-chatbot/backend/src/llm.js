/**
 * Minimal OpenAI client -- two shapes, because this agent needs two very
 * different kinds of call:
 *
 *   streamChat()      long, free-form, user-visible. Streamed token by token
 *                     so the customer sees words appear instead of a spinner.
 *
 *   completeJSON()    short, structured, machine-consumed. Uses JSON mode
 *                     (`response_format: {type: "json_object"}`) and is NOT
 *                     streamed -- there is no partial value in half a JSON
 *                     object, and waiting for it costs less than parsing
 *                     incrementally.
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
 * Accepts a full `messages` array rather than a system/user pair: this agent
 * replays prior turns and `role:"tool"` results into the prompt, so the shape
 * is genuinely multi-message.
 *
 * @param {{
 *   messages: {role: string, content: string}[],
 *   model?: string,
 *   onToken: (text: string) => void,
 *   maxTokens?: number,
 *   temperature?: number,
 * }} opts
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function streamChat({
  messages,
  model,
  onToken,
  maxTokens = 700,
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
      messages,
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

/**
 * One non-streamed call in JSON mode. Returns the parsed object.
 *
 * JSON mode guarantees syntactically valid JSON, not a valid SHAPE -- the
 * model can still omit a field or invent one. Callers are expected to
 * normalise the result against a known contract rather than trust it (see
 * condense.js), which is also why a parse failure here returns null instead
 * of throwing: a broken classifier should degrade the turn, not kill it.
 *
 * @param {{
 *   system: string,
 *   user: string,
 *   model?: string,
 *   maxTokens?: number,
 *   temperature?: number,
 * }} opts
 * @returns {Promise<object|null>}
 */
export async function completeJSON({
  system,
  user,
  model,
  maxTokens = 400,
  temperature = 0,
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
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI JSON call failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Plain non-streamed text completion. Used by the summarizer, where the
 * output is prose stored on the conversation document and nobody is watching
 * it arrive.
 */
export async function completeText({
  system,
  user,
  model,
  maxTokens = 400,
  temperature = 0.1,
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
    throw new Error(`OpenAI text call failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}
