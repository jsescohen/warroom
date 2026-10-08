import { apiFetch } from '../auth/account';
import { tasks, type AiInfo, type AiRequest, type AiResponse, type TaskId } from '../../shared/ai/tasks';

export type AiOutcome<T extends TaskId> = AiResponse<T> | { data: AiResponse<T>['data']; valid: false; error: string; skipped?: boolean };

/**
 * Browser-side gateway to the AI server. Never throws: on any failure it returns the task's
 * fallback with `valid: false` so game code always has something safe to work with.
 */
export async function runAiTask<T extends TaskId>(req: AiRequest<T>): Promise<AiOutcome<T>> {
  const fallback = tasks[req.task].fallback as AiResponse<T>['data'];
  try {
    const res = await apiFetch('/api/ai/task', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) return { data: fallback, valid: false, error: body.error ?? 'rate limited', skipped: true };
    if (!res.ok) return { data: fallback, valid: false, error: body.error ?? `HTTP ${res.status}` };
    return body as AiResponse<T>;
  } catch (e) {
    return { data: fallback, valid: false, error: (e as Error).message };
  }
}

export async function getAiInfo(): Promise<AiInfo | { error: string }> {
  try {
    const res = await apiFetch('/api/ai/info');
    const body = await res.json();
    return res.ok ? body : { error: body.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { error: 'AI server not reachable' };
  }
}

/** Round-trip check that the configured model can produce valid JSON. */
export const pingAi = () =>
  runAiTask({
    task: 'ping',
    system: 'You are a radio operator. Reply only with JSON.',
    prompt: 'Confirm the line is open. Return JSON exactly like {"ok": true, "message": "<a short in-character confirmation>"}.',
  });
