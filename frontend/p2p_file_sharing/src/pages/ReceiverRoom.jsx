import { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Radio, Download, File, Image, Video, Music,
  FileText, Archive, CheckCircle2, Loader2
} from 'lucide-react';
import socket from '../lib/socket';
import { formatBytes} from '../lib/utils';
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

  // If came from Home page, we have state; otherwise need to join
  const [ setName] = useState(location.state?.name || '');
  const [ownerName, setOwnerName] = useState(location.state?.ownerName || '');
  const [files, setFiles] = useState(location.state?.metadata || []);
  const [joined, setJoined] = useState(!!location.state?.name);
  const [showJoinModal, setShowJoinModal] = useState(!location.state?.name);
  const [joinName, setJoinName] = useState('');
  const [error, setError] = useState('');
  const [downloadStatus, setDownloadStatus] = useState({}); // fileId -> { status, progress, receivedSize }
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
    // Find the file metadata to get name and type
    setFiles(currentFiles => {
      const fileMeta = currentFiles.find(f => f.fileId === fileId);
      if (fileMeta) {
        // Trigger download
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
      <div className="min-h-screen flex flex-col items-center justify-center px-6">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-surface-4 flex items-center justify-center mx-auto">
            <Radio size={28} className="text-zinc-600" />
          </div>
          <h1 className="text-xl font-bold text-zinc-200">Room Closed</h1>
          <p className="text-sm text-zinc-500">The sender has disconnected and the room no longer exists.</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-5 py-2 rounded-lg bg-surface-2 border border-surface-4 text-sm text-zinc-300 hover:bg-surface-3 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <nav className="flex items-center justify-between px-6 py-4 md:px-10 border-b border-surface-3">
        <div className="flex items-center gap-2">
          <Radio className="text-accent" size={20} />
          <span className="font-display font-bold text-sm tracking-tight">warp</span>
        </div>
        {joined && (
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
            Connected to <span className="text-zinc-300 font-medium">{ownerName}'s room</span>
          </div>
        )}
      </nav>

      {/* Main content */}
      {joined ? (
        <div className="flex-1 p-6 md:p-10 max-w-3xl mx-auto w-full">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-zinc-100 mb-1">
              {ownerName}'s Files
            </h1>
            <p className="text-sm text-zinc-500">
              Pick the files you want to receive. They'll transfer directly from {ownerName}.
            </p>
          </div>

          {files.length === 0 ? (
            <div className="text-center py-20 rounded-2xl bg-surface-1 border border-surface-3">
              <Loader2 size={24} className="text-zinc-600 mx-auto mb-3 animate-spin" />
              <p className="text-sm text-zinc-400">Waiting for files...</p>
              <p className="text-xs text-zinc-600 mt-1">The sender hasn't added any files yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((f) => {
                const iconType = getIconType(f.type);
                const Icon = FILE_ICONS[iconType] || File;
                const status = downloadStatus[f.fileId];
                const isDownloading = status?.status === 'downloading';
                const isComplete = status?.status === 'complete';

                // Calculate progress percentage from receivedSize
                let progressPct = 0;
                if (isDownloading && f.size > 0 && status.receivedSize) {
                  progressPct = Math.min(99, Math.round((status.receivedSize / f.size) * 100));
                }
                if (isComplete) progressPct = 100;

                return (
                  <div
                    key={f.fileId}
                    className="flex items-center gap-3 p-4 rounded-xl bg-surface-1 border border-surface-3 group transition-all hover:border-surface-4"
                  >
                    <div className="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center shrink-0">
                      <Icon size={18} className="text-zinc-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{f.name}</p>
                      <p className="text-xs text-zinc-500">{formatBytes(f.size)}</p>
                      {isDownloading && (
                        <div className="mt-1.5 w-full h-1 rounded-full bg-surface-3 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {isComplete ? (
                      <div className="flex items-center gap-1.5 text-emerald-400">
                        <CheckCircle2 size={16} />
                        <span className="text-xs font-medium">Done</span>
                      </div>
                    ) : isDownloading ? (
                      <div className="flex items-center gap-1.5 text-accent">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-xs font-medium">{progressPct}%</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDownload(f.fileId)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors"
                      >
                        <Download size={14} />
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

      {/* Join Modal (when accessing via direct link) */}
      <Modal open={showJoinModal} onClose={() => navigate('/')}>
        <h2 className="font-display text-lg font-bold mb-1">Join Room</h2>
        <p className="text-sm text-zinc-500 mb-5">Enter your name to join this file sharing room.</p>
        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Your Name</label>
        <input
          type="text"
          value={joinName}
          onChange={(e) => setJoinName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="e.g. Jamie"
          autoFocus
          className="w-full px-4 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-accent/50 transition-colors"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          onClick={handleJoin}
          disabled={!joinName.trim()}
          className="mt-4 w-full py-2.5 rounded-lg bg-accent text-surface-0 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-300 transition-colors"
        >
          Join Room
        </button>
      </Modal>
    </div>
  );
}