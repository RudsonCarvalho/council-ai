import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SetupPage     from './pages/SetupPage.jsx';
import DebatePage    from './pages/DebatePage.jsx';
import ExecutionPage from './pages/ExecutionPage.jsx';
import HistoryPage   from './pages/HistoryPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<SetupPage />}     />
        <Route path="/debate"    element={<DebatePage />}    />
        <Route path="/execution" element={<ExecutionPage />} />
        <Route path="/history"   element={<HistoryPage />}   />
        <Route path="*"          element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
