import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Link2, Shield, Zap, Users, Radio } from 'lucide-react';
import Modal from '../components/Modal';
import socket from '../lib/socket';

export default function Home() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.on('room-created', ({ roomId }) => {
      setLoading(false);
      navigate(`/send/${roomId}`, { state: { name } });
    });

    socket.on('room-error', (msg) => {
      setError(msg);
      setLoading(false);
    });

    socket.on('joined-room', ({ ownerName, metadata }) => {
      setLoading(false);
      navigate(`/room/${roomCode}`, { state: { name, ownerName, metadata } });
    });

    return () => {
      socket.off('room-created');
      socket.off('room-error');
      socket.off('joined-room');
    };
  }, [navigate, name, roomCode]);

  const handleCreate = () => {
    if (!name.trim()) return;
    setLoading(true);
    socket.emit('create-room', { name: name.trim() });
  };

  const handleJoin = () => {
    if (!name.trim() || !roomCode.trim()) return;
    setLoading(true);
    setError('');

    // Extract roomId from a full URL or just use the code
    let id = roomCode.trim();
    const urlMatch = id.match(/\/room\/([a-f0-9-]+)/i);
    if (urlMatch) id = urlMatch[1];

    socket.emit('join-room', { roomId: id, name: name.trim() });
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-2">
          <Radio className="text-accent" size={22} />
          <span className="font-display font-bold text-lg tracking-tight">warp</span>
        </div>
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-display tracking-wide"
        >
          v1.0
        </a>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        {/* Glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />

        <div className="relative max-w-2xl text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-surface-4 text-xs text-zinc-400 font-display tracking-wide mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
            peer-to-peer · encrypted · no upload limits
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05]">
            Send files,{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-cyan-200">
              not to servers
            </span>
          </h1>

          <p className="text-zinc-400 text-lg md:text-xl max-w-lg mx-auto leading-relaxed">
            Create a room, share the link, and transfer files directly between devices through WebRTC. Nothing touches a server.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <button
              onClick={() => { setShowCreate(true); setName(''); setError(''); }}
              className="group flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-surface-0 font-semibold text-sm hover:bg-cyan-300 transition-all duration-200 shadow-lg shadow-accent/20"
            >
              Create Room
              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button
              onClick={() => { setShowJoin(true); setName(''); setRoomCode(''); setError(''); }}
              className="flex items-center gap-2 px-6 py-3 rounded-xl border border-surface-4 text-zinc-300 font-semibold text-sm hover:bg-surface-2 hover:border-surface-4 transition-all duration-200"
            >
              <Link2 size={16} />
              Join with Code
            </button>
          </div>
        </div>

        {/* Feature cards */}
        <div className="relative mt-24 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl w-full">
          {[
            { icon: Zap, title: 'Direct Transfer', desc: 'Files go straight from sender to receiver over WebRTC. Zero server storage.' },
            { icon: Shield, title: 'Private by Design', desc: 'No accounts, no tracking, no file retention. Rooms disappear when you leave.' },
            { icon: Users, title: 'Multi-Receiver', desc: 'Share with multiple people at once. Each person picks what they need.' },
          ].map((item) => {
            const IconComp = item.icon;
            return (
              <div
                key={item.title}
                className="group p-5 rounded-2xl bg-surface-1 border border-surface-3 hover:border-surface-4 transition-all duration-300"
              >
                <div className="w-9 h-9 rounded-lg bg-surface-3 flex items-center justify-center mb-3 group-hover:bg-accent/10 transition-colors">
                  <IconComp size={18} className="text-zinc-400 group-hover:text-accent transition-colors" />
                </div>
                <h3 className="font-semibold text-sm mb-1">{item.title}</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </main>

      {/* Create Room Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)}>
        <h2 className="font-display text-lg font-bold mb-1">Create a Room</h2>
        <p className="text-sm text-zinc-500 mb-5">You'll be the sender. Share the link with receivers.</p>
        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Your Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="e.g. Alex"
          autoFocus
          className="w-full px-4 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-accent/50 transition-colors"
        />
        <button
          onClick={handleCreate}
          disabled={!name.trim() || loading}
          className="mt-4 w-full py-2.5 rounded-lg bg-accent text-surface-0 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-300 transition-colors"
        >
          {loading ? 'Creating...' : 'Create Room'}
        </button>
      </Modal>

      {/* Join Room Modal */}
      <Modal open={showJoin} onClose={() => setShowJoin(false)}>
        <h2 className="font-display text-lg font-bold mb-1">Join a Room</h2>
        <p className="text-sm text-zinc-500 mb-5">Enter the room code or paste the link shared with you.</p>
        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Your Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jamie"
          autoFocus
          className="w-full px-4 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-accent/50 transition-colors mb-3"
        />
        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Room Code or Link</label>
        <input
          type="text"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="Paste link or room ID"
          className="w-full px-4 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-accent/50 transition-colors"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          onClick={handleJoin}
          disabled={!name.trim() || !roomCode.trim() || loading}
          className="mt-4 w-full py-2.5 rounded-lg bg-accent text-surface-0 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-300 transition-colors"
        >
          {loading ? 'Joining...' : 'Join Room'}
        </button>
      </Modal>
    </div>
  );
}