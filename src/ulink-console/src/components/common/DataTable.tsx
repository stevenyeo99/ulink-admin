import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  /** The server's sort key for this column; omit for a column that can't be sorted. */
  sortKey?: string;
  className?: string;
  render: (row: T) => ReactNode;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** 0-based page; the table shows "x–y of total" and previous / next. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  isError?: boolean;
  emptyText: string;
}

/**
 * The dashboard's one table: server-side sort and paging (the page owns the query and keeps it in
 * the URL), clickable rows, and loading / error / empty states. Search and filters sit above it on
 * each page, so every list — Cases, Review Queue, module pages — reads the same way.
 */
export function DataTable<T>({
  columns, rows, rowKey, onRowClick, sort, onSortChange, page, pageSize, total, onPageChange, isLoading, isError, emptyText,
}: DataTableProps<T>) {
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  const toggleSort = (key: string) =>
    onSortChange?.({ key, dir: sort?.key === key && sort.dir === 'desc' ? 'asc' : 'desc' });

  return (
    <div className="overflow-hidden rounded-xl2 border border-slate-900/5 bg-white/80 shadow-glass backdrop-blur-xl">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-900/5 text-xs font-medium text-slate-500">
              {columns.map((col) => {
                const active = sort?.key === col.sortKey;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={clsx('px-5 py-3 font-medium', col.className)}
                    aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {col.sortKey && onSortChange ? (
                      <button
                        onClick={() => toggleSort(col.sortKey as string)}
                        className="inline-flex items-center gap-1 rounded hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
                      >
                        {col.header}
                        {active ? (
                          sort?.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                        ) : (
                          <ArrowUpDown size={12} className="text-slate-300" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={clsx(isLoading && rows.length > 0 && 'opacity-60')}>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={clsx(
                  'border-b border-slate-900/5 last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none'
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={clsx('px-5 py-3 align-top', col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLoading && rows.length === 0 && <p className="p-6 text-sm text-slate-400">Loading…</p>}
      {isError && <p className="p-6 text-sm text-red-600">Couldn't load this list. Refresh to try again.</p>}
      {!isLoading && !isError && rows.length === 0 && <p className="p-6 text-sm text-slate-500">{emptyText}</p>}

      {total > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-900/5 px-5 py-2.5 text-xs text-slate-500">
          <span>
            {first}–{last} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 0}
              className="rounded-md p-1.5 hover:bg-slate-900/5 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={last >= total}
              className="rounded-md p-1.5 hover:bg-slate-900/5 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
