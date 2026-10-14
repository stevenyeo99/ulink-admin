import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { uploadCaseDocuments } from '../../api/casesApi';
import { Button } from '../common/Button';
import type { CaseDetail } from '../../types/case';

// API cases waiting on documents (ulink-api modules/api-console-watch WATCHED_STATUSES, SYSTEM_4 E4-04).
const UPLOADABLE = ['API_NO_DOCUMENTS', 'API_CLAIM_SUSPENDED', 'API_DOCUMENTS_REVIEW', 'API_DOCUMENTS_UNSURE', 'API_DOCUMENTS_UPLOADED', 'API_UPLOAD_NOT_IN_CONSOLE'];
const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * Upload the documents the customer sent (SYSTEM_4 E4-04): they go to the IAS console as the case's next submission;
 * once the console gives them a barcode the case is read and checked again, and the IAS claim revised. Any user.
 */
export function CaseUploadPanel({ caseRecord }: { caseRecord: CaseDetail }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [comment, setComment] = useState('');

  const upload = useMutation({
    mutationFn: async () =>
      uploadCaseDocuments(caseRecord.id, comment.trim(), await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type, data: await toBase64(f) })))),
    onSuccess: () => {
      setFiles([]);
      setComment('');
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  if (caseRecord.source !== 'API' || !UPLOADABLE.includes(caseRecord.currentStatus)) return null;

  const total = files.reduce((n, f) => n + f.size, 0);
  const problem =
    files.length > MAX_FILES ? `Choose at most ${MAX_FILES} files.`
      : total > MAX_BYTES ? `The files are ${(total / 1048576).toFixed(1)} MB together; the limit is 20 MB.`
        : null;
  const canSend = files.length > 0 && !problem && comment.trim().length >= 3 && !upload.isPending;

  return (
    <section className="mb-6 rounded-xl2 border border-ulink-teal/30 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="text-sm font-semibold text-slate-800">Upload documents</h2>
      <p className="mb-3 mt-1 text-sm text-slate-600">
        Documents the customer sent you (PDF, JPG or PNG, up to {MAX_FILES} files, 20 MB). They go to the IAS console as this case's next
        submission; once the console gives them a barcode (usually 15–30 minutes) the case is checked again and the IAS claim revised.
      </p>
      <input
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="mb-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
      />
      {problem && <p className="mb-2 text-xs text-red-600">{problem}</p>}
      <label className="mb-3 block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Comment (kept in the case history)</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="e.g. Customer sent the medical report by Viber on 14 Oct."
          className="w-full rounded-lg border border-slate-900/10 px-3 py-2 text-sm outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
        />
      </label>
      <Button onClick={() => upload.mutate()} disabled={!canSend}>
        <Upload size={15} className="mr-1.5 inline" />
        {upload.isPending ? 'Uploading…' : `Upload ${files.length || ''} file${files.length === 1 ? '' : 's'} to the console`}
      </Button>
      {upload.isError && <p className="mt-2 text-sm text-red-600">{(upload.error as Error).message}</p>}
      {upload.isSuccess && <p className="mt-2 text-sm text-ulink-teal-dark">Uploaded. The case waits for the console, then is checked again.</p>}
    </section>
  );
}
