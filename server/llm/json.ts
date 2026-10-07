/**
 * Pull a JSON object out of a model reply. Small models wrap JSON in prose or code fences,
 * add trailing commas, or use smart quotes; this handles the common cases and returns
 * undefined when nothing parseable is found (never throws).
 */
export function extractJson(text: string): unknown {
  if (!text) return undefined;
  let s = text.trim();

  // strip <think>...</think> blocks emitted by reasoning models
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // prefer the contents of a ```json fence if present
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const direct = tryParse(s);
  if (direct !== undefined) return direct;

  // otherwise take the first balanced {...} block
  const block = firstBalancedObject(s);
  if (!block) return undefined;
  return tryParse(block) ?? tryParse(repair(block));
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function repair(s: string) {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1'); // trailing commas
}

function firstBalancedObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}
