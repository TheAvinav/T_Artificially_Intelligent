import { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Download, File, Image, Video, Music,
  FileText, Archive, CheckCircle2, Loader2, Link2
} from 'lucide-react';
import socket from '../lib/socket';
import { formatBytes } from '../lib/utils';
import { useReceiverWebRTC } from '../hooks/useWebRTC';
import Modal from '../components/Modal';

const FILE_ICONS = {
  file: File, image: Image, video: Video, music: Music,
  'file-text': FileText, archive: Archive,
};

function getIconType(type) {
  if (!type) return 'file';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'music';
  if (type.includes('pdf') || type.includes('text') || type.includes('document')) return 'file-text';
  if (type.includes('zip') || type.includes('rar') || type.includes('tar')) return 'archive';
  return 'file';
}

export default function ReceiverRoom() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [name, setName] = useState(location.state?.name || '');
  const [ownerName, setOwnerName] = useState(location.state?.ownerName || '');
  const [files, setFiles] = useState(location.state?.metadata || []);
  const [joined, setJoined] = useState(!!location.state?.name);
  const [showJoinModal, setShowJoinModal] = useState(!location.state?.name);
  const [joinName, setJoinName] = useState('');
  const [error, setError] = useState('');
  const [downloadStatus, setDownloadStatus] = useState({});
  const [roomClosed, setRoomClosed] = useState(false);

  const handleReceiverProgress = useCallback((fileId, receivedSize) => {
    setDownloadStatus(prev => {
      const existing = prev[fileId] || {};
      return {
        ...prev,
        [fileId]: { ...existing, receivedSize }
      };
    });
  }, []);

  const handleFileReceived = useCallback((fileId, blob) => {
    setFiles(currentFiles => {
      const fileMeta = currentFiles.find(f => f.fileId === fileId);
      if (fileMeta) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileMeta.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      return currentFiles;
    });

    setDownloadStatus(prev => ({
      ...prev,
      [fileId]: { status: 'complete', receivedSize: 0 }
    }));
  }, []);

  const { requestFile, handleOffer, handleIceCandidate, cleanup } =
    useReceiverWebRTC(handleReceiverProgress, handleFileReceived);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.on('joined-room', ({ ownerName: on, metadata }) => {
      setOwnerName(on);
      setFiles(metadata || []);
      setJoined(true);
      setShowJoinModal(false);
    });

    socket.on('new-files', (newFiles) => {
      setFiles(prev => [...prev, ...newFiles]);
    });

    socket.on('room-error', (msg) => {
      setError(msg);
    });

    socket.on('room-closed', () => {
      setRoomClosed(true);
    });

    socket.on('webrtc-offer', handleOffer);
    socket.on('ice-candidate', handleIceCandidate);

    return () => {
      socket.off('joined-room');
      socket.off('new-files');
      socket.off('room-error');
      socket.off('room-closed');
      socket.off('webrtc-offer');
      socket.off('ice-candidate');
      cleanup();
    };
  }, [handleOffer, handleIceCandidate, cleanup]);

  const handleJoin = () => {
    if (!joinName.trim()) return;
    setName(joinName.trim());
    setError('');
    socket.emit('join-room', { roomId, name: joinName.trim() });
  };

  const handleDownload = (fileId) => {
    setDownloadStatus(prev => ({
      ...prev,
      [fileId]: { status: 'downloading', receivedSize: 0 }
    }));
    requestFile(roomId, fileId);
  };

  if (roomClosed) {
    return (
      <div className="scanline-bg grain min-h-screen flex flex-col items-center justify-center px-6">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 rounded-lg bg-raised border border-dim flex items-center justify-center mx-auto">
            <span className="font-mono text-lg text-muted">×</span>
          </div>
          <h1 className="text-lg font-semibold">Room Closed</h1>
          <p className="text-sm text-muted max-w-xs">The sender disconnected. This room no longer exists.</p>
          <button
            onClick={() => navigate('/')}
            className="mt-2 px-5 py-2 rounded bg-surface border border-dim text-sm text-secondary hover:bg-overlay transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="scanline-bg grain min-h-screen flex flex-col">
      {/* Header */}
      <nav className="flex items-center justify-between px-6 py-3.5 md:px-8 border-b border-dim">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-accent/10 border border-accent/20 flex items-center justify-center">
            <span className="text-accent font-mono text-[10px] font-bold">W</span>
          </div>
          <span className="font-mono text-xs text-muted">/</span>
          <span className="font-mono text-xs text-secondary">receive</span>
        </div>
        {joined && (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-surface border border-dim">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="font-mono text-[10px] text-muted">
              connected to <span className="text-secondary">{ownerName}</span>
            </span>
          </div>
        )}
      </nav>

      {/* Main */}
      {joined ? (
        <div className="flex-1 p-6 md:p-10 max-w-2xl mx-auto w-full">
          {/* Room info */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded bg-accent/10 border border-accent/20 flex items-center justify-center text-[10px] font-mono font-bold text-accent uppercase">
                {ownerName.charAt(0)}
              </div>
              <h1 className="text-xl font-semibold">{ownerName}'s files</h1>
            </div>
            <p className="text-sm text-muted ml-9">
              Select files to receive. They transfer directly from {ownerName} via WebRTC.
            </p>
          </div>

          {/* File list */}
          {files.length === 0 ? (
            <div className="text-center py-16 rounded-lg bg-raised border border-dim">
              <Loader2 size={20} className="text-muted mx-auto mb-3 animate-spin" />
              <p className="text-sm text-secondary">Waiting for files...</p>
              <p className="font-mono text-[10px] text-muted mt-1">The sender hasn't added anything yet</p>
            </div>
          ) : (
            <div className="space-y-1.5 stagger">
              {files.map((f) => {
                const iconType = getIconType(f.type);
                const FileIcon = FILE_ICONS[iconType] || File;
                const status = downloadStatus[f.fileId];
                const isDownloading = status?.status === 'downloading';
                const isComplete = status?.status === 'complete';

                let progressPct = 0;
                if (isDownloading && f.size > 0 && status.receivedSize) {
                  progressPct = Math.min(99, Math.round((status.receivedSize / f.size) * 100));
                }
                if (isComplete) progressPct = 100;

                return (
                  <div
                    key={f.fileId}
                    className="animate-fade-up opacity-0 flex items-center gap-3 px-4 py-3.5 rounded-lg bg-raised border border-dim group hover:border-mid transition-all"
                  >
                    <div className="w-9 h-9 rounded bg-surface border border-dim flex items-center justify-center shrink-0">
                      <FileIcon size={15} className="text-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">{f.name}</p>
                      <p className="font-mono text-[10px] text-muted">{formatBytes(f.size)}</p>
                      {isDownloading && (
                        <div className="mt-2 w-full h-1 rounded-full bg-dim overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {isComplete ? (
                      <div className="flex items-center gap-1.5 text-green-500">
                        <CheckCircle2 size={14} />
                        <span className="font-mono text-[10px] font-medium">done</span>
                      </div>
                    ) : isDownloading ? (
                      <div className="flex items-center gap-1.5 text-accent">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="font-mono text-[10px] font-medium">{progressPct}%</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDownload(f.fileId)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-accent bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors"
                      >
                        <Download size={12} />
                        Receive
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* Join Modal */}
      <Modal open={showJoinModal} onClose={() => navigate('/')}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-5 h-5 rounded bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Link2 size={10} className="text-accent" />
          </div>
          <h2 className="font-semibold text-sm">Join Room</h2>
        </div>
        <p className="text-xs text-muted mb-5 ml-7">Enter your name to join this file sharing room.</p>
        <label className="block font-mono text-[10px] text-muted mb-1.5 uppercase tracking-wider">Name</label>
        <input
          type="text"
          value={joinName}
          onChange={(e) => setJoinName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="Your name"
          autoFocus
          className="w-full px-3 py-2.5 rounded bg-base border border-dim text-sm placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors font-mono"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          onClick={handleJoin}
          disabled={!joinName.trim()}
          className="mt-4 w-full py-2.5 rounded bg-accent font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent-dim transition-colors"
          style={{ color: '#0c0c0e' }}
        >
          Join Room
        </button>
      </Modal>
    </div>
  );
}