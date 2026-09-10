import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { BatchListPage } from './components/BatchListPage';
import { BatchDetailPage } from './components/BatchDetailPage';
import { ComparePage } from './components/ComparePage';
import { ScanQRModal } from './components/ScanQRModal';

// Shared TanStack Query client with caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min default
      refetchOnWindowFocus: false,
    },
  },
});

// App Router Content inside BrowserRouter
const AppContent: React.FC = () => {
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Handle any legacy hash URLs gracefully (e.g. #/batches -> /batches)
  useEffect(() => {
    if (window.location.hash) {
      const hashPath = window.location.hash.replace(/^#\/?/, '/');
      if (hashPath && hashPath !== '/' && hashPath !== location.pathname) {
        navigate(hashPath, { replace: true });
      }
    }
  }, [location.pathname, navigate]);

  const handleSelectBatch = (batchId: string) => {
    navigate(`/batches/${batchId}`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-slate-900 selection:text-white">
      {/* Top Navbar */}
      <Header onOpenQR={() => setIsQRModalOpen(true)} />

      {/* Primary Route Pages */}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<LandingPage onOpenQR={() => setIsQRModalOpen(true)} />} />
          <Route path="/batches" element={<BatchListPage onOpenQR={() => setIsQRModalOpen(true)} />} />
          <Route path="/batches/:batch_id" element={<BatchDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Global Scanner Modal (opens over any page) */}
      <ScanQRModal
        isOpen={isQRModalOpen}
        onClose={() => setIsQRModalOpen(false)}
        onSelectBatch={handleSelectBatch}
      />
    </div>
  );
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
