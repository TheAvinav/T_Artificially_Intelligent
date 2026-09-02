import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Link2, WifiOff, LogOut, Plus, FolderUp, Upload, Download } from 'lucide-react';
import socket from '../lib/socket';
import { formatBytes, formatSpeed, formatDuration } from '../lib/utils';
import { useUploader } from '../hooks/useUploader';
import { useDownloader } from '../hooks/useDownloader';
import { useVisibilityReconnect } from '../hooks/useVisibilityReconnect';
import PayloadList from '../components/PayloadList';
import Modal from '../components/Modal';

const ACTIVE_STATUSES = ['connecting', 'negotiating', 'transferring'];

export default function ReceiverRoom() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [name, setName] = useState(location.state?.name || '');
  const [ownerName, setOwnerName] = useState(location.state?.ownerName || '');
  const [ownerSocketId, setOwnerSocketId] = useState(location.state?.ownerSocketId || '');
  const [files, setFiles] = useState((location.state?.metadata || []).map(f => ({ ...f, mine: false })));
  const [otherReceivers, setOtherReceivers] = useState(location.state?.receivers || []);
  const [uploadPolicy, setUploadPolicyState] = useState(location.state?.uploadPolicy || 'owner-only');
  const [joined, setJoined] = useState(!!location.state?.name);
  const [showJoinModal, setShowJoinModal] = useState(!location.state?.name);
  const [joinName, setJoinName] = useState('');
  const [joinOtp, setJoinOtp] = useState(location.state?.otp || '');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [connectionLost, setConnectionLost] = useState(false);
  const [ownerAway, setOwnerAway] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Kept in sync so a reconnect can silently re-join with the same
  // credentials instead of forcing the user to re-enter the PIN.
  const sessionRef = useRef({ name: location.state?.name || '', otp: location.state?.otp || '' });
  const wasDisconnectedRef = useRef(false);
  const autoRejoiningRef = useRef(false);

  const uploader = useUploader(roomId);
  const downloader = useDownloader(files);

  useVisibilityReconnect();

  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.on('joined-room', ({ ownerName: on, ownerSocketId: ownerSid, metadata, uploadPolicy: policy, receivers: roster }) => {
      setOwnerName(on);
      setOwnerSocketId(ownerSid || '');
      setFiles((metadata || []).map(f => ({ ...f, mine: false })));
      setOtherReceivers((roster || []).filter(r => r.socketId !== socket.id));
      setUploadPolicyState(policy || 'owner-only');
      setJoined(true);
      setShowJoinModal(false);
      setConnectionLost(false);
      autoRejoiningRef.current = false;
    });

    socket.on('new-files', (newFiles) => {
      setFiles(prev => [...prev, ...newFiles.map(f => ({ ...f, mine: false }))]);
    });

    socket.on('files-removed', ({ fileIds }) => {
      setFiles(prev => prev.filter(f => !fileIds.includes(f.fileId)));
    });

    socket.on('receiver-joined', ({ socketId, name: n }) => {
      if (socketId === socket.id) return;
      setOtherReceivers(prev => {
        if (prev.find(r => r.socketId === socketId)) return prev;
        return [...prev, { socketId, name: n }];
      });
    });

    socket.on('receiver-left', ({ socketId }) => {
      setOtherReceivers(prev => prev.filter(r => r.socketId !== socketId));
    });

    socket.on('upload-policy-changed', ({ policy }) => setUploadPolicyState(policy));

    socket.on('room-error', (msg) => {
      if (autoRejoiningRef.current) {
        // The silent reconnect attempt failed — the room is genuinely gone.
        autoRejoiningRef.current = false;
        navigate('/', { state: { disconnectedReason: msg || 'This room no longer exists.' } });
        return;
      }
      setError(msg);
    });

    socket.on('room-closed', (data) => {
      const reason = data?.reason === 'idle-timeout'
        ? 'This room was closed after being idle for too long.'
        : data?.reason === 'sender-disconnected'
          ? "The sender's connection dropped and didn't come back."
          : 'This room was closed.';
      navigate('/', { state: { disconnectedReason: reason } });
    });

    socket.on('owner-disconnected', () => setOwnerAway(true));
    socket.on('owner-reconnected', ({ ownerSocketId: newOwnerSid } = {}) => {
      setOwnerAway(false);
      if (newOwnerSid) setOwnerSocketId(newOwnerSid);
    });

    socket.on('disconnect', () => {
      wasDisconnectedRef.current = true;
      setConnectionLost(true);
    });

    socket.on('connect', () => {
      if (!wasDisconnectedRef.current) return; // initial connect, not a reconnect
      wasDisconnectedRef.current = false;

      const { name: savedName, otp: savedOtp } = sessionRef.current;
      if (joined && savedName && savedOtp) {
        autoRejoiningRef.current = true;
        socket.emit('join-room', { roomId, name: savedName, otp: savedOtp });
      } else {
        setConnectionLost(false);
      }
    });

    return () => {
      socket.off('joined-room');
      socket.off('new-files');
      socket.off('files-removed');
      socket.off('receiver-joined');
      socket.off('receiver-left');
      socket.off('upload-policy-changed');
      socket.off('room-error');
      socket.off('room-closed');
      socket.off('owner-disconnected');
      socket.off('owner-reconnected');
      socket.off('disconnect');
      socket.off('connect');
    };
  }, [roomId, joined, navigate]);

  const handleJoin = () => {
    if (!joinName.trim() || joinOtp.trim().length !== 6) return;
    setName(joinName.trim());
    setError('');
    sessionRef.current = { name: joinName.trim(), otp: joinOtp.trim() };
    socket.emit('join-room', { roomId, name: joinName.trim(), otp: joinOtp.trim() });
  };

  const handleLeaveRoom = () => {
    socket.emit('leave-room', { roomId });
    navigate('/');
  };

  const startDownload = (fileId) => downloader.startDownload(roomId, fileId);

  const toggleSelected = (fileId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const receiveSelected = () => {
    selected.forEach(fileId => startDownload(fileId));
    setSelected(new Set());
  };

  const addFiles = (fileList) => {
    uploader.uploadFiles(fileList, (ackFiles) => {
      setFiles(prev => [...prev, ...ackFiles.map(f => ({ ...f, mine: true }))]);
    });
  };

  const handleFileInput = (e) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const removeFile = (fileId) => {
    setFiles(prev => prev.filter(f => f.fileId !== fileId));
    uploader.removeFile(fileId);
  };

  const canUpload = uploadPolicy === 'anyone';

  // Everyone else who could conceivably download a file I upload: the owner
  // plus every other receiver (never myself).
  const recipients = useMemo(() => {
    const list = [...otherReceivers];
    if (ownerSocketId) list.unshift({ socketId: ownerSocketId, name: ownerName || 'Owner' });
    return list;
  }, [otherReceivers, ownerSocketId, ownerName]);

  // Aggregate progress across every file I'm currently receiving.
  const activeDownloadEntries = useMemo(() => {
    return files
      .filter(f => !f.mine)
      .map(f => ({ f, status: downloader.downloads[f.fileId] }))
      .filter(({ status }) => status && ACTIVE_STATUSES.includes(status.status));
  }, [files, downloader.downloads]);

  const aggregate = useMemo(() => {
    if (activeDownloadEntries.length < 2) return null;
    const totalBytes = activeDownloadEntries.reduce((acc, { f }) => acc + (f.size || 0), 0);
    const receivedBytes = activeDownloadEntries.reduce((acc, { status }) => acc + (status.receivedSize || 0), 0);
    const speedBps = activeDownloadEntries.reduce((acc, { status }) => acc + (status.speedBps || 0), 0);
    const remaining = totalBytes - receivedBytes;
    const etaSeconds = speedBps > 0 ? remaining / speedBps : null;
    const pct = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0;
    return { count: activeDownloadEntries.length, pct, speedBps, etaSeconds };
  }, [activeDownloadEntries]);

  const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);

  return (
    <div className="scanline-bg grain min-h-screen flex flex-col">
      {/* Connection banners */}
      {connectionLost && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20">
          <WifiOff size={12} className="text-red-400" />
          <span className="font-mono text-[11px] text-red-400">Connection lost — trying to reconnect…</span>
        </div>
      )}
      {!connectionLost && ownerAway && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20">
          <WifiOff size={12} className="text-yellow-500" />
          <span className="font-mono text-[11px] text-yellow-500">
            {ownerName || 'The sender'}'s connection dropped — waiting for them to come back…
          </span>
        </div>
      )}

      {/* Header */}
      <nav className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 sm:px-6 md:px-8 border-b border-dim">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-accent/10 border border-accent/20 flex items-center justify-center">
            <span className="text-accent font-mono text-[10px] font-bold">W</span>
          </div>
          <span className="font-mono text-xs text-muted">/</span>
          <span className="font-mono text-xs text-secondary">receive</span>
        </div>
        {joined && (
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-surface border border-dim max-w-[60vw] sm:max-w-none">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connectionLost ? 'bg-red-500' : 'bg-green-500'}`} />
              <span className="font-mono text-[10px] text-muted truncate">
                connected to <span className="text-secondary">{ownerName}</span>
              </span>
            </div>
            <button
              onClick={handleLeaveRoom}
              title="Leave room"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
            >
              <LogOut size={12} /> Leave
            </button>
          </div>
        )}
      </nav>

      {/* Main */}
      {joined ? (
        <div className="flex-1 p-6 md:p-10 max-w-2xl mx-auto w-full">
          {/* Room info */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded bg-accent/10 border border-accent/20 flex items-center justify-center text-[10px] font-mono font-bold text-accent uppercase">
                {ownerName.charAt(0)}
              </div>
              <h1 className="text-xl font-semibold">{ownerName}'s room</h1>
            </div>
            <p className="text-sm text-muted ml-9">
              Files transfer directly between browsers via WebRTC.
              {canUpload && ' You can add files here too.'}
            </p>
          </div>

          {/* Aggregate download progress */}
          {aggregate && (
            <div className="mb-4 p-3.5 rounded-lg bg-raised border border-dim">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 justify-between mb-2">
                <span className="font-mono text-[10px] text-secondary">
                  Receiving {aggregate.count} files &middot; {aggregate.pct}%
                </span>
                <span className="font-mono text-[10px] text-muted">
                  {formatSpeed(aggregate.speedBps)} {formatDuration(aggregate.etaSeconds)}
                </span>
              </div>
              <div className="w-full h-1 rounded-full bg-dim overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${aggregate.pct}%` }} />
              </div>
            </div>
          )}

          {/* Bulk select bar */}
          {selected.size > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 justify-between px-3.5 py-2.5 rounded-lg bg-accent/10 border border-accent/20">
              <span className="font-mono text-[11px] text-accent">{selected.size} selected</span>
              <button
                onClick={receiveSelected}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-accent bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors"
              >
                <Download size={12} /> Receive Selected
              </button>
            </div>
          )}

          {/* Upload area (only when the room allows it) */}
          {canUpload && (
            <div className="mb-6">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
                <h2 className="font-mono text-xs text-secondary uppercase tracking-wider">Add files</h2>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-secondary hover:bg-overlay transition-colors"
                  >
                    <FolderUp size={13} /> Add Folder
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
                <input ref={fileInputRef} type="file" multiple onChange={handleFileInput} className="hidden" />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  webkitdirectory=""
                  directory=""
                  onChange={handleFileInput}
                  className="hidden"
                />
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center py-8 rounded-lg border-2 border-dashed cursor-pointer transition-all duration-200 ${
                  isDragging
                    ? 'border-accent/40 bg-accent/[0.04]'
                    : 'border-dim hover:border-mid bg-raised/50'
                }`}
              >
                <Upload size={16} className="text-muted mb-2" />
                <p className="text-xs text-muted">Drop files here or click to browse</p>
              </div>
            </div>
          )}

          {/* File list */}
          <div className="mb-3 flex items-center gap-3">
            <h2 className="font-mono text-xs text-secondary uppercase tracking-wider">Payload</h2>
            {files.length > 0 && (
              <span className="font-mono text-[10px] text-muted px-1.5 py-0.5 rounded bg-surface border border-dim">
                {files.length} file{files.length !== 1 ? 's' : ''} &middot; {formatBytes(totalSize)}
              </span>
            )}
          </div>

          {files.length === 0 ? (
            <div className="text-center py-16 rounded-lg bg-raised border border-dim">
              <p className="text-sm text-secondary">Waiting for files...</p>
              <p className="font-mono text-[10px] text-muted mt-1">
                {canUpload ? 'Add some above, or wait for someone else to.' : "The sender hasn't added anything yet"}
              </p>
            </div>
          ) : (
            <PayloadList
              files={files}
              transfers={uploader.transfers}
              transferKey={uploader.transferKey}
              downloads={downloader.downloads}
              recipients={recipients}
              onDownload={startDownload}
              onRetryDownload={downloader.retry}
              onCancelDownload={downloader.cancel}
              onTogglePause={uploader.togglePause}
              onCancelUpload={uploader.handleCancelTransfer}
              onRetryUpload={uploader.handleRetryTransfer}
              onRemoveFile={removeFile}
              selected={selected}
              onToggleSelect={toggleSelected}
            />
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
        <p className="text-xs text-muted mb-5 ml-7">Enter your name and the PIN the sender shared with you.</p>
        <label className="block font-mono text-[10px] text-muted mb-1.5 uppercase tracking-wider">Name</label>
        <input
          type="text"
          value={joinName}
          onChange={(e) => setJoinName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="Your name"
          autoFocus
          className="w-full px-3 py-2.5 rounded bg-base border border-dim text-sm placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors font-mono mb-3"
        />
        <label className="block font-mono text-[10px] text-muted mb-1.5 uppercase tracking-wider">PIN</label>
        <input
          type="text"
          inputMode="numeric"
          value={joinOtp}
          onChange={(e) => setJoinOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="6-digit PIN"
          className="w-full px-3 py-2.5 rounded bg-base border border-dim text-sm placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors font-mono tracking-[0.3em]"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          onClick={handleJoin}
          disabled={!joinName.trim() || joinOtp.trim().length !== 6}
          className="mt-4 w-full py-2.5 rounded bg-accent font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent-dim transition-colors"
          style={{ color: '#0c0c0e' }}
        >
          Join Room
        </button>
      </Modal>
    </div>
  );
}
