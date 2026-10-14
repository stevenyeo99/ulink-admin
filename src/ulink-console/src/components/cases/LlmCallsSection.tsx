import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { getLlmCalls } from '../../api/casesApi';
import type { LlmCall } from '../../types/case';

const STATUS_STYLE: Record<LlmCall['status'], string> = {
  ok: 'bg-ulink-teal/10 text-ulink-teal-dark',
  error: 'bg-red-50 text-red-700',
  timeout: 'bg-red-50 text-red-700',
  too_long: 'bg-amber-50 text-amber-700',
};

/**
 * Every AI call made for this case (ulink_llm_calls, SYSTEM_4 E4-26): when, which job and prompt version, how it went,
 * and — expanded — what the AI answered. Loaded only when the technical details are open.
 */
export function LlmCallsSection({ caseId }: { caseId: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['llm-calls', caseId], queryFn: () => getLlmCalls(caseId) });
  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (isError) return <p className="text-sm text-red-600">Couldn't load the AI calls.</p>;
  const calls = data?.calls ?? [];
  if (calls.length === 0) return <p className="text-sm text-slate-500">No AI calls recorded for this case (calls are recorded from 14 Oct 2026).</p>;

  return (
    <ul className="divide-y divide-slate-900/5 text-xs">
      {calls.map((call) => (
        <li key={call.id} className="py-1.5">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-slate-600">
              <span className="font-mono text-slate-400">{new Date(call.createdAt).toLocaleString('en-GB')}</span>
              <span className={clsx('rounded-full px-1.5 py-0.5 font-semibold', STATUS_STYLE[call.status])}>{call.status}</span>
              <span className="font-medium text-slate-800">{call.promptName ?? call.callType}</span>
              {call.promptVersion && <span className="font-mono text-slate-400">v{call.promptVersion}</span>}
              {call.job && <span>· {call.job}</span>}
              {call.durationMs != null && <span>· {(call.durationMs / 1000).toFixed(1)} s</span>}
              {(call.promptTokens != null || call.estimatedTokens != null) && (
                <span>
                  · {call.promptTokens ?? `~${call.estimatedTokens}`} in{call.completionTokens != null && ` / ${call.completionTokens} out`} tokens
                </span>
              )}
              {call.confidence != null && <span>· confidence {Math.round(call.confidence * 100)}%</span>}
            </summary>
            {call.error && <p className="mt-1 text-red-600">{call.error}</p>}
            {call.output && <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-700">{call.output}</pre>}
            {call.model && <p className="mt-1 text-slate-400">Model: {call.model}</p>}
          </details>
        </li>
      ))}
    </ul>
  );
}
