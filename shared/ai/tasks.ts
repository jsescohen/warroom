import { z } from 'zod';

// ---- lenient field parsers: small models format things loosely --------------------------------

export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Extreme'] as const;
export const AGREEMENT_TYPES = ['alliance', 'non-aggression', 'ceasefire', 'peace', 'territory', 'joint-war', 'demand'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** "high", "HIGH risk", "Very high" → "High"; "critical"/"severe" → "Extreme". */
const risk = z.preprocess((v) => {
  const s = String(v ?? '').toLowerCase();
  if (/extreme|critical|severe|very high/.test(s)) return 'Extreme';
  if (/high/.test(s)) return 'High';
  if (/med|moderate/.test(s)) return 'Medium';
  if (/low|minimal/.test(s)) return 'Low';
  return v;
}, z.enum(RISK_LEVELS));

/** "45%", "45", 0.45 → 45 (clamped 0..100). */
const percent = z.preprocess((v) => {
  let n = typeof v === 'string' ? parseFloat(v.replace('%', '')) : Number(v);
  if (Number.isFinite(n) && n > 0 && n <= 1 && !String(v).includes('%')) n *= 100;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : v;
}, z.number());

/** A string or list of strings → trimmed list, capped. */
const lines = (max: number) =>
  z.preprocess((v) => {
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n|;|•/) : [];
    return arr.map((x) => String(typeof x === 'object' && x ? Object.values(x).join(': ') : x).trim()).filter(Boolean).slice(0, max);
  }, z.array(z.string().max(300)));

const text = (max: number) => z.preprocess((v) => (v == null ? '' : String(v).trim().slice(0, max)), z.string().min(1));

/**
 * Structured AI tasks. Each task has a zod schema that every model response is validated
 * against, plus a safe fallback used when the model fails twice. Shared by client and server.
 * Later steps add: 'diplomacy' (leader chat), 'aiTurn' (nation decisions).
 */
export const tasks = {
  ping: {
    schema: z.object({ ok: z.boolean(), message: z.string().max(200) }),
    fallback: { ok: false, message: 'The model did not return valid JSON.' },
    maxTokens: 120,
    temperature: 0,
  },
  /** AI Assessor: in-character briefing before a major action. */
  assess: {
    schema: z.object({
      summary: text(400),
      consequences: lines(5),
      militaryRisk: text(300),
      successChance: percent,
      likelyEnemies: lines(8),
      risk,
      advice: text(300),
    }),
    fallback: {
      summary: 'Your advisors could not be reached. Rely on the staff estimate.',
      consequences: [] as string[],
      militaryRisk: 'Unknown.',
      successChance: 50,
      likelyEnemies: [] as string[],
      risk: 'Medium' as RiskLevel,
      advice: 'Proceed only if the staff estimate supports it.',
    },
    maxTokens: 550,
    temperature: 0.6,
  },
  /** Diplomacy: a foreign leader replies in character with a structured outcome. */
  diplomacy: {
    schema: z.object({
      reply: text(900),
      relationChange: z.preprocess((v) => {
        const n = typeof v === 'string' ? parseFloat(v) : Number(v);
        return Number.isFinite(n) ? Math.max(-10, Math.min(10, Math.round(n))) : 0;
      }, z.number()),
      accepted: z.preprocess((v) => {
        if (v === true || v === false || v === null) return v;
        const s = String(v ?? '').toLowerCase();
        if (/^(yes|true|accept)/.test(s)) return true;
        if (/^(no|false|reject|decline)/.test(s)) return false;
        return null;
      }, z.boolean().nullable()),
      agreementProposed: z.preprocess((v) => v === true || String(v).toLowerCase() === 'true', z.boolean()),
      agreementType: z.preprocess((v) => {
        const s = String(v ?? 'none').toLowerCase().replace(/[_\s]+/g, '-');
        if (/alli/.test(s)) return 'alliance';
        if (/non-?aggr|pact/.test(s)) return 'non-aggression';
        if (/cease|truce|armistice/.test(s)) return 'ceasefire';
        if (/peace/.test(s)) return 'peace';
        if (/joint|coalition/.test(s)) return 'joint-war';
        if (/demand|ultimat/.test(s)) return 'demand';
        if (/territ|trade|exchange|cede/.test(s)) return 'territory';
        return 'none';
      }, z.enum(['none', ...AGREEMENT_TYPES])),
      terms: z.preprocess(
        (v) => (v && typeof v === 'object' ? v : {}),
        z.object({ give: lines(6), take: lines(6), target: z.preprocess((v) => (v == null ? '' : String(v)), z.string()) }),
      ),
      memory: z.preprocess((v) => (v == null ? '' : String(v).trim().slice(0, 160)), z.string()),
    }),
    fallback: {
      reply: '',
      relationChange: 0,
      accepted: null as boolean | null,
      agreementProposed: false,
      agreementType: 'none' as 'none' | (typeof AGREEMENT_TYPES)[number],
      terms: { give: [] as string[], take: [] as string[], target: '' },
      memory: '',
    },
    maxTokens: 450,
    temperature: 0.8,
  },
} as const;

export type TaskId = keyof typeof tasks;
export type TaskResult<T extends TaskId> = z.infer<(typeof tasks)[T]['schema']>;

/** 'player' requests jump the queue; 'ai' requests (autonomous nations) are throttled per actor. */
export type Priority = 'player' | 'ai';

export interface AiRequest<T extends TaskId = TaskId> {
  task: T;
  system: string;
  prompt: string;
  priority?: Priority;
  /** Who is asking (e.g. a nation id). Used for per-actor cooldowns on 'ai' priority. */
  actor?: string;
}

export interface AiResponse<T extends TaskId = TaskId> {
  data: TaskResult<T>;
  /** false when `data` is the fallback because the model never produced valid JSON. */
  valid: boolean;
  provider: string;
  model: string;
  attempts: number;
  ms: number;
}

export interface AiInfo {
  provider: string;
  model: string;
  queueLength: number;
}
