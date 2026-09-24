import { useSearchParams } from 'react-router-dom';
import type { Source } from '../types/pipeline';

/**
 * Which workflow a page shows, kept in the URL (?source=api) so a link or reload keeps the tab.
 * Email is the default — the page looks exactly as before for anyone who never picks API.
 */
export function useSource(): [Source, (source: Source) => void] {
  const [params, setParams] = useSearchParams();
  const source: Source = params.get('source')?.toUpperCase() === 'API' ? 'API' : 'EMAIL';
  const setSource = (next: Source) => setParams(next === 'EMAIL' ? {} : { source: 'api' }, { replace: true });
  return [source, setSource];
}
