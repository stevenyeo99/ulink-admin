import clsx from 'clsx';
import type { Source } from '../../types/pipeline';

/** Which flow a row comes from, on the work lists' "All" tab. */
export function SourceTag({ source }: { source: Source }) {
  return (
    <span className={clsx('mr-1.5 inline-flex rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide', source === 'API' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600')}>
      {source === 'API' ? 'API' : 'Email'}
    </span>
  );
}
