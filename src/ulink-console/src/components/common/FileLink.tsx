import { useState, type ReactNode } from 'react';
import { authFetch } from '../../api/client';

/**
 * Opens a case file (document image, email attachment) in a new tab. The file endpoints need the
 * login token, which a plain link can't send — so this fetches the file with it and opens the result.
 * The tab is opened straight away (on the click) so the browser doesn't block it as a pop-up.
 */
export function FileLink({ path, className, children }: { path: string; className?: string; children: ReactNode }) {
  const [failed, setFailed] = useState(false);

  const open = async () => {
    setFailed(false);
    const tab = window.open('', '_blank');
    try {
      const response = await authFetch(path);
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab?.close();
      setFailed(true);
    }
  };

  return (
    <button type="button" onClick={open} className={className} title={failed ? "Couldn't open this file. Try again." : undefined}>
      {children}
      {failed && <span className="text-red-600">Couldn't open</span>}
    </button>
  );
}
