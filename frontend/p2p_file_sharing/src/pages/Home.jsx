import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Link2, Shield, Zap, Users } from 'lucide-react';
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
    let id = roomCode.trim();
    const urlMatch = id.match(/\/room\/([a-f0-9-]+)/i);
    if (urlMatch) id = urlMatch[1];
    socket.emit('join-room', { roomId: id, name: name.trim() });
  };

  return (
    <div className="scanline-bg grain min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 md:px-12 border-b border-dim">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-accent/10 border border-accent/20 flex items-center justify-center">
            <span className="text-accent font-mono text-xs font-bold">W</span>
          </div>
          <span className="font-mono font-semibold text-sm tracking-tight text-secondary">warp</span>
        </div>
        <div className="flex items-center gap-2 text-muted font-mono text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500/60" />
          online
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        {/* Warm ambient glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[400px] rounded-full bg-accent/[0.04] blur-[100px] pointer-events-none" />

        <div className="relative max-w-xl text-center stagger">
          {/* Badge */}
          <div className="animate-fade-up opacity-0 inline-flex items-center gap-2 px-3 py-1.5 rounded border border-dim bg-raised font-mono text-[11px] text-muted tracking-wide mb-8">
            <span className="w-1 h-1 rounded-full bg-accent" />
            P2P &middot; WEBRTC &middot; NO SERVER STORAGE
          </div>

          {/* Headline */}
          <h1 className="animate-fade-up opacity-0 text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.1] mb-5">
            Ship files,<br />
            <span className="text-accent">not to the cloud</span>
          </h1>

          {/* Sub */}
          <p className="animate-fade-up opacity-0 text-secondary text-base md:text-lg max-w-md mx-auto leading-relaxed mb-10">
            Create a room. Share the link. Files travel directly between devices over WebRTC. Nothing gets stored anywhere.
          </p>

          {/* CTAs */}
          <div className="animate-fade-up opacity-0 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => { setShowCreate(true); setName(''); setError(''); }}
              className="group flex items-center gap-2.5 px-6 py-3 rounded-lg bg-accent text-base font-semibold text-sm tracking-wide hover:bg-accent-dim transition-all duration-200"
              style={{ color: '#0c0c0e' }}
            >
              Create Room
              <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button
              onClick={() => { setShowJoin(true); setName(''); setRoomCode(''); setError(''); }}
              className="flex items-center gap-2.5 px-6 py-3 rounded-lg border border-dim text-secondary font-semibold text-sm tracking-wide hover:bg-raised hover:text-[var(--text-primary)] transition-all duration-200"
            >
              <Link2 size={15} />
              Join Room
            </button>
          </div>
        </div>

        {/* Feature strip */}
        <div className="relative mt-20 flex flex-col sm:flex-row items-stretch gap-px max-w-2xl w-full rounded-lg overflow-hidden border border-dim stagger">
          {[
            { icon: Zap, label: 'Direct', desc: 'Peer-to-peer transfer over WebRTC. No middleman.' },
            { icon: Shield, label: 'Private', desc: 'No accounts, no logs, no file retention.' },
            { icon: Users, label: 'Multi-peer', desc: 'One room, many receivers. Each picks what they need.' },
          ].map((item) => {
            const IconComp = item.icon;
            return (
              <div
                key={item.label}
                className="animate-fade-up opacity-0 flex-1 p-5 bg-raised hover:bg-surface transition-colors duration-200"
              >
                <div className="flex items-center gap-2 mb-2">
                  <IconComp size={14} className="text-accent" />
                  <span className="font-mono text-xs font-medium text-[var(--text-primary)] uppercase tracking-wider">{item.label}</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-dim px-6 py-4 flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted">warp v1.0</span>
        <span className="font-mono text-[10px] text-muted">built for T_Artificially_Intelligent</span>
      </footer>

      {/* Create Room Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-5 h-5 rounded bg-accent/10 border border-accent/20 flex items-center justify-center">
            <span className="text-accent text-[10px] font-mono font-bold">+</span>
          </div>
          <h2 className="font-semibold text-sm">Create a Room</h2>
        </div>
        <p className="text-xs text-muted mb-5 ml-7">You'll be the sender. Share the link with receivers.</p>
        <label className="block font-mono text-[10px] text-muted mb-1.5 uppercase tracking-wider">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="Your name"
          autoFocus
          className="w-full px-3 py-2.5 rounded bg-base border border-dim text-sm placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors font-mono"
        />
        <button
          onClick={handleCreate}
          disabled={!name.trim() || loading}
          className="mt-4 w-full py-2.5 rounded bg-accent font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent-dim transition-colors"
          style={{ color: '#0c0c0e' }}
        >
          {loading ? 'Creating...' : 'Create Room'}
        </button>
      </Modal>

      {/* Join Room Modal */}
      <Modal open={showJoin} onClose={() => setShowJoin(false)}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-5 h-5 rounded bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Link2 size={10} className="text-accent" />
          </div>
          <h2 className="font-semibold text-sm">Join a Room</h2>
        </div>
        <p className="text-xs text-muted mb-5 ml-7">Enter the room code or paste the link.</p>
        <label className="block font-mono text-[10px] text-muted mb-1.5 uppercase tracking-wider">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoFocus
          className="w-full px-3 py-2.5 rounded bg-base border border-dim text-sm placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors font-mono mb-3"
        />
        <label className="block font-mono text-[10px] text-muted mb-1.5 uppercase tracking-wider">Room Code / Link</label>
        <input
          type="text"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="Paste link or room ID"
          className="w-full px-3 py-2.5 rounded bg-base border border-dim text-sm placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors font-mono"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          onClick={handleJoin}
          disabled={!name.trim() || !roomCode.trim() || loading}
          className="mt-4 w-full py-2.5 rounded bg-accent font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent-dim transition-colors"
          style={{ color: '#0c0c0e' }}
        >
          {loading ? 'Joining...' : 'Join Room'}
        </button>
      </Modal>
    </div>
  );
}