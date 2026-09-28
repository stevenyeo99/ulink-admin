import { useState } from 'react';
import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { BackgroundBlobs } from './components/layout/BackgroundBlobs';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { PipelinePage } from './pages/PipelinePage';
import { CasesPage } from './pages/CasesPage';
import { CaseDetailPage } from './pages/CaseDetailPage';
import { OverviewPage } from './pages/OverviewPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { LoginPage } from './pages/LoginPage';
import { useReviewQueue } from './hooks/useCases';
import { getSession } from './lib/session';

export function App() {
  return (
    <>
      <BackgroundBlobs />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<LoggedIn />} />
      </Routes>
    </>
  );
}

/** Every page except login needs a logged-in user; without one, go to login and come back here after. */
function LoggedIn() {
  const location = useLocation();
  if (!getSession()) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Shell />;
}

function Shell() {
  // The sidebar count: cases in the Review Queue, both workflows.
  const { data } = useReviewQueue();
  const [menuOpen, setMenuOpen] = useState(false);

  // Dashboard shell (SB Admin pattern): sidebar on the left, top bar + page on the right.
  return (
    <div className="relative flex h-screen overflow-hidden">
      <Sidebar reviewCount={data?.total} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onOpenMenu={() => setMenuOpen(true)} />
        {/* React Flow (PipelinePage) needs a bounded, non-scrolling container to measure
            against — it pans/zooms internally rather than relying on page scroll. The case
            pages are normal scrollable content instead, so each of them opts into its own
            overflow-y-auto rather than this shared wrapper doing it for everyone. */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/review" element={<ReviewQueuePage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/cases" element={<CasesPage />} />
            <Route path="/cases/:id" element={<CaseDetailPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
