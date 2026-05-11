import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/game/:sessionId" element={<LobbyPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
