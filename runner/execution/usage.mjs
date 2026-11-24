import { createReadStream } from 'node:fs';
import readline from 'node:readline';

export async function collectUsage(file) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let cachedUsageComplete = true;
  let found = false;
  let malformedLines = 0;
  const stream = createReadStream(file, { encoding: 'utf8' });
  try {
    for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { malformedLines += 1; continue; }
      if (event.type !== 'turn.completed') continue;
      const usage = event.usage;
      if (!Number.isSafeInteger(usage?.input_tokens) || !Number.isSafeInteger(usage?.output_tokens)
        || usage.input_tokens < 0 || usage.output_tokens < 0) continue;
      found = true;
      inputTokens += usage.input_tokens;
      outputTokens += usage.output_tokens;
      if (Number.isSafeInteger(usage.cached_input_tokens) && usage.cached_input_tokens >= 0) {
        cachedInputTokens += usage.cached_input_tokens;
      } else cachedUsageComplete = false;
    }
  } finally {
    stream.destroy();
  }
  if (!found) return { inputTokens: null, outputTokens: null, cachedInputTokens: null, reason: malformedLines ? 'invalid_or_missing_usage_events' : 'missing_usage_events' };
  return { inputTokens, outputTokens, cachedInputTokens: cachedUsageComplete ? cachedInputTokens : null, reason: malformedLines ? 'some_malformed_events' : null };
}

export async function collectSessionId(file) {
  const stream = createReadStream(file, { encoding: 'utf8' });
  try {
    for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'thread.started' && typeof event.thread_id === 'string' && event.thread_id) return event.thread_id;
    }
    return null;
  } finally { stream.destroy(); }
}
