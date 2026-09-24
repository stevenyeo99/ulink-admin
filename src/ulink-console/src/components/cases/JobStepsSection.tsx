import clsx from 'clsx';
import { JsonViewer } from '../panel/JsonViewer';
import type { ApiCaseStep } from '../../types/case';

const STATUS_STYLE: Record<ApiCaseStep['status'], string> = {
  DONE: 'bg-ulink-teal/15 text-ulink-teal-dark',
  WAITING: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-100 text-red-600',
};

/**
 * An API case's job runs, oldest first (ulink_api_case_steps): each job's input — the earlier
 * jobs' outputs it received — and its output or error. The input → output chain, for debugging
 * one case.
 */
export function JobStepsSection({ steps }: { steps: ApiCaseStep[] }) {
  if (steps.length === 0) return <p className="text-sm text-slate-400">No job has run for this case yet.</p>;

  return (
    <ol className="space-y-2">
      {steps.map((step) => (
        <li key={step.id} className="rounded-xl border border-slate-900/5 bg-white/60 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-800">{step.job}</span>
            <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_STYLE[step.status])}>{step.status}</span>
            <span className="ml-auto text-xs text-slate-400">{new Date(step.finishedAt ?? step.startedAt).toLocaleString()}</span>
          </div>
          {step.error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{step.error}</p>}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500">Input</summary>
            <div className="mt-1"><JsonViewer value={step.input} /></div>
          </details>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-slate-500">Output</summary>
            <div className="mt-1"><JsonViewer value={step.output} /></div>
          </details>
        </li>
      ))}
    </ol>
  );
}
