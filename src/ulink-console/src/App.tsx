import { Routes, Route } from 'react-router-dom';
import { BackgroundBlobs } from './components/layout/BackgroundBlobs';
import { AppNav } from './components/layout/AppNav';
import { PipelinePage } from './pages/PipelinePage';
import { CasesPage } from './pages/CasesPage';
import { CaseDetailPage } from './pages/CaseDetailPage';
import { useCases } from './hooks/useCases';

const NEEDS_REVIEW_STATUSES = 'INCOMPLETE,MEMBER_REVIEW_REQUIRED';

export function App() {
  // Distinct from CasesPage's own unfiltered fetch (different query key, see useCases.ts) —
  // this one exists purely to drive the nav badge, which should reflect "how many need a
  // human," not the total case count.
  const { data } = useCases(NEEDS_REVIEW_STATUSES);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <BackgroundBlobs />
      <AppNav reviewCount={data?.total} />
      {/* React Flow (PipelinePage) needs a bounded, non-scrolling container to measure
          against — it pans/zooms internally rather than relying on page scroll. The case
          pages are normal scrollable content instead, so each of them opts into its own
          overflow-y-auto rather than this shared wrapper doing it for everyone. */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <Routes>
          <Route path="/" element={<PipelinePage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/:id" element={<CaseDetailPage />} />
        </Routes>
      </div>
    </div>
  );
}
