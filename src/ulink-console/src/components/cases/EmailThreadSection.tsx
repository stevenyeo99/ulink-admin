import { useState } from 'react';
import { Paperclip, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { getAttachmentUrl } from '../../api/casesApi';
import { formatBytes } from '../../lib/formatBytes';
import type { EmailMessage, EmailThread } from '../../types/case';

function formatTimestamp(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function MessageRow({ caseId, message }: { caseId: string; message: EmailMessage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-slate-900/5 p-3">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-start gap-2 text-left">
        {expanded ? (
          <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                message.direction === 'inbound' ? 'bg-ulink-teal/15 text-ulink-teal-dark' : 'bg-slate-100 text-slate-500'
              )}
            >
              {message.direction}
            </span>
            <p className="truncate text-sm font-medium text-slate-800">{message.subject || '(no subject)'}</p>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {message.fromAddr ?? '—'} → {message.toAddr ?? '—'} · {formatTimestamp(message.receivedAt)}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pl-6">
          {message.bodyText && (
            <p className="mb-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              {message.bodyText}
            </p>
          )}
          {message.EmailAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.EmailAttachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={getAttachmentUrl(caseId, attachment.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-900/10 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-ulink-orange/40 hover:text-ulink-orange-dark"
                >
                  <Paperclip size={12} />
                  {attachment.originalFilename ?? 'attachment'}
                  <span className="text-slate-400">{formatBytes(attachment.sizeBytes)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EmailThreadSection({ caseId, threads }: { caseId: string; threads: EmailThread[] }) {
  if (threads.length === 0) {
    return <p className="text-sm italic text-slate-400">No email thread on this case</p>;
  }

  return (
    <div className="space-y-4">
      {threads.map((thread) => (
        <div key={thread.id} className="space-y-2">
          {thread.EmailMessages.map((message) => (
            <MessageRow key={message.id} caseId={caseId} message={message} />
          ))}
        </div>
      ))}
    </div>
  );
}
