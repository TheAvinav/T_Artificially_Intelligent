import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import SenderRoom from './pages/SenderRoom';
import ReceiverRoom from './pages/ReceiverRoom';

export default function App() {
  return (
    <div className="noise-bg min-h-screen">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<ReceiverRoom />} />
        <Route path="/send/:roomId" element={<SenderRoom />} />
      </Routes>
    </div>
  );
}