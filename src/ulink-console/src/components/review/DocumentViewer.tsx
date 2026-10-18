import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { authFetch } from '../../api/client';
import type { PageRef, ViewFile } from '../../lib/caseFiles';

/**
 * Left side of the review workspace (SYSTEM_4 E4-20): the case's files, the open page, zoom and rotate. Files are
 * fetched with the login token. PDFs open in the browser's own viewer at the page; images zoom and rotate here.
 */
export function DocumentViewer({ files, open, onOpen }: { files: ViewFile[]; open: PageRef | null; onOpen: (ref: PageRef) => void }) {
  const file = files.find((f) => f.key === open?.fileKey) ?? files[0];
  // open is null until a page is chosen; with no files, file is undefined too — compare only a real choice.
  const page = open && open.fileKey === file?.key ? open.page : 1;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);

  // Keyed on the file's path, not the object: a case refetch rebuilds the list, and that must not reload the file
  // (or reset zoom / rotation).
  const filePath = file?.path;
  useEffect(() => {
    if (!filePath) return undefined;
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    setZoom(1);
    setTurn(0);
    authFetch(filePath)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        objectUrl = URL.createObjectURL(await response.blob());
        if (!cancelled) setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath]);

  if (!file) return <p className="p-4 text-sm text-slate-500">No documents on this case.</p>;
  const groups = [...new Set(files.map((f) => f.group))];

  return (
    <div className="flex h-full min-h-[32rem] gap-3">
      <nav aria-label="Documents" className="w-44 shrink-0 overflow-y-auto pr-1 text-xs">
        {groups.map((group) => (
          <div key={group} className="mb-3">
            <p className="mb-1 font-semibold text-slate-500">{group}</p>
            {files.filter((f) => f.group === group).map((f) => (
              <button
                key={f.key}
                onClick={() => onOpen({ fileKey: f.key, page: 1 })}
                aria-current={f.key === file.key}
                className={clsx('block w-full truncate rounded px-2 py-1 text-left', f.key === file.key ? 'bg-ulink-teal/10 font-medium text-ulink-teal-dark' : 'text-slate-600 hover:bg-slate-900/5')}
                title={f.name}
              >
                {f.name.split('/').pop()}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-600">
          <span className="truncate font-medium" title={file.name}>{file.name}</span>
          {file.pdf ? (
            <label className="ml-auto flex items-center gap-1">
              Page
              <input
                type="number"
                min={1}
                value={page}
                onChange={(e) => onOpen({ fileKey: file.key, page: Math.max(1, Number(e.target.value) || 1) })}
                className="w-14 rounded border border-slate-900/10 px-1.5 py-0.5"
              />
            </label>
          ) : (
            <span className="ml-auto flex gap-1">
              <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="rounded p-1 hover:bg-slate-900/5"><ZoomOut size={15} /></button>
              <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="rounded p-1 hover:bg-slate-900/5"><ZoomIn size={15} /></button>
              <button aria-label="Rotate" onClick={() => setTurn((t) => (t + 90) % 360)} className="rounded p-1 hover:bg-slate-900/5"><RotateCw size={15} /></button>
            </span>
          )}
        </div>
        <div className="flex-1 overflow-auto rounded-lg border border-slate-900/10 bg-slate-50">
          {failed && <p className="p-4 text-sm text-red-600">Couldn't open this file.</p>}
          {!failed && !url && <p className="p-4 text-sm text-slate-400">Loading…</p>}
          {url && file.pdf && <iframe key={`${url}#${page}`} title={file.name} src={`${url}#page=${page}`} className="h-full min-h-[32rem] w-full" />}
          {url && !file.pdf && (
            <img
              src={url}
              alt={file.name}
              // Zoom by width (scrolls cleanly); rotate around the centre.
              style={{ width: `${zoom * 100}%`, maxWidth: 'none', transform: `rotate(${turn}deg)` }}
              className="transition-transform"
            />
          )}
        </div>
      </div>
    </div>
  );
}
