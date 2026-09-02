import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  Copy, Check, Plus, Users, Upload, Send, Link2, Share2, KeyRound,
  FolderUp, WifiOff, LogOut
} from 'lucide-react';
import socket from '../lib/socket';
import { formatBytes, formatSpeed, formatDuration } from '../lib/utils';
import { useUploader } from '../hooks/useUploader';
import { useDownloader } from '../hooks/useDownloader';
import { useVisibilityReconnect } from '../hooks/useVisibilityReconnect';
import PayloadList from '../components/PayloadList';
import Modal from '../components/Modal';

const ACTIVE_STATUSES = ['connecting', 'negotiating', 'transferring'];

export default function SenderRoom() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const senderName = location.state?.name || 'You';
  const otp = location.state?.otp || '';
  const ownerToken = location.state?.ownerToken || '';

  const [copied, setCopied] = useState(false);
  const [otpCopied, setOtpCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [receivers, setReceivers] = useState([]);
  const [files, setFiles] = useState([]); // unified: mine + everyone else's
  const [uploadPolicy, setUploadPolicy] = useState(location.state?.uploadPolicy || 'owner-only');
  const [isDragging, setIsDragging] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const qrCanvasRef = useRef(null);
  const wasDisconnectedRef = useRef(false);

  const uploader = useUploader(roomId);
  const downloader = useDownloader(files);

  useVisibilityReconnect();

  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.on('receiver-joined', ({ socketId, name }) => {
      setReceivers(prev => {
        if (prev.find(r => r.socketId === socketId)) return prev;
        return [...prev, { socketId, name }];
      });
    });

    socket.on('receiver-left', ({ socketId }) => {
      setReceivers(prev => prev.filter(r => r.socketId !== socketId));
    });

    socket.on('new-files', (newFiles) => {
      setFiles(prev => [...prev, ...newFiles.map(f => ({ ...f, mine: false }))]);
    });

    socket.on('files-removed', ({ fileIds }) => {
      setFiles(prev => prev.filter(f => !fileIds.includes(f.fileId)));
    });

    socket.on('upload-policy-changed', ({ policy }) => setUploadPolicy(policy));

    socket.on('disconnect', () => {
      wasDisconnectedRef.current = true;
      setConnectionLost(true);
    });

    socket.on('connect', () => {
      if (!wasDisconnectedRef.current) return; // this is the initial connect, not a reconnect
      wasDisconnectedRef.current = false;
      if (ownerToken) {
        socket.emit('reclaim-room', { roomId, ownerToken });
      } else {
        navigate('/', { state: { disconnectedReason: 'Lost connection to the server.' } });
      }
    });

    socket.on('room-reclaimed', ({ receivers: currentReceivers, uploadPolicy: policy }) => {
      setConnectionLost(false);
      setReceivers(currentReceivers || []);
      if (policy) setUploadPolicy(policy);
    });

    socket.on('reclaim-failed', (msg) => {
      setConnectionLost(false);
      navigate('/', { state: { disconnectedReason: msg || 'This room no longer exists.' } });
    });

    socket.on('room-closed', (data) => {
      const reason = data?.reason === 'idle-timeout'
        ? 'This room was closed after being idle for too long.'
        : 'This room was closed.';
      navigate('/', { state: { disconnectedReason: reason } });
    });

    return () => {
      socket.off('receiver-joined');
      socket.off('receiver-left');
      socket.off('new-files');
      socket.off('files-removed');
      socket.off('upload-policy-changed');
      socket.off('disconnect');
      socket.off('connect');
      socket.off('room-reclaimed');
      socket.off('reclaim-failed');
      socket.off('room-closed');
    };
  }, [roomId, ownerToken, navigate]);

  const handleCloseRoom = () => {
    socket.emit('close-room', { roomId });
    setShowCloseConfirm(false);
    navigate('/');
  };

  const shareLink = `${window.location.origin}/room/${roomId}`;

  useEffect(() => {
    if (qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, shareLink, {
        width: 128,
        margin: 1,
        color: { dark: '#e8e8ea', light: '#00000000' }
      }).catch(() => {});
    }
  }, [shareLink]);

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyOtp = () => {
    navigator.clipboard.writeText(otp);
    setOtpCopied(true);
    setTimeout(() => setOtpCopied(false), 2000);
  };

  const shareRoom = async () => {
    const shareText = `Join my warp room:\n${shareLink}\nPIN: ${otp}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join my warp room', text: shareText });
      } catch {
        // user cancelled the share sheet — no-op
      }
      return;
    }
    navigator.clipboard.writeText(shareText);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const handleSetUploadPolicy = (policy) => {
    setUploadPolicy(policy);
    socket.emit('set-upload-policy', { roomId, policy });
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

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  // Aggregate progress across every file THIS tab is currently sending out.
  const aggregate = useMemo(() => {
    const active = Object.entries(uploader.transfers)
      .filter(([, t]) => ACTIVE_STATUSES.includes(t.status));
    if (active.length < 2) return null;

    let sentBytes = 0;
    let totalBytes = 0;
    let speedBps = 0;

    active.forEach(([k, t]) => {
      const file = files.find(f => k.startsWith(f.fileId));
      if (!file) return;
      totalBytes += file.size;
      sentBytes += (file.size * (t.progress || 0)) / 100;
      speedBps += t.speedBps || 0;
    });

    const remaining = totalBytes - sentBytes;
    const etaSeconds = speedBps > 0 ? remaining / speedBps : null;
    const pct = totalBytes > 0 ? Math.min(99, Math.round((sentBytes / totalBytes) * 100)) : 0;

    return { count: active.length, pct, speedBps, etaSeconds };
  }, [uploader.transfers, files]);

  return (
    <div className="scanline-bg grain min-h-screen flex flex-col">
      {/* Reconnecting banner */}
      {connectionLost && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20">
          <WifiOff size={12} className="text-red-400" />
          <span className="font-mono text-[11px] text-red-400">
            Connection lost — trying to reconnect… (room stays open for a bit)
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
          <span className="font-mono text-xs text-secondary">room</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded bg-surface border border-dim">
            <Send size={10} className="text-accent" />
            <span className="font-mono text-[10px] text-secondary">
              Sending as <span className="text-[var(--text-primary)] font-medium">{senderName}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${connectionLost ? 'bg-red-500' : 'bg-green-500'}`} />
            <span className="font-mono text-[10px] text-muted">{connectionLost ? 'offline' : 'live'}</span>
          </div>
          <button
            onClick={() => setShowCloseConfirm(true)}
            title="Close room for everyone"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={12} /> Close Room
          </button>
        </div>
      </nav>

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left panel */}
        <div className="flex-1 p-6 md:p-8 lg:p-10">
          {/* Share room */}
          <div className="mb-6 flex flex-col sm:flex-row items-start gap-5 p-4 rounded-lg bg-raised border border-dim">
            <canvas ref={qrCanvasRef} className="rounded shrink-0 bg-base" />

            <div className="flex-1 w-full space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Link2 size={11} className="text-accent" />
                  <span className="font-mono text-[10px] text-muted uppercase tracking-widest">Room Code</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3.5 py-2 rounded bg-base border border-dim font-mono text-sm text-[var(--text-primary)] tracking-[0.2em] select-all">
                    {roomId}
                  </div>
                  <button
                    onClick={copyLink}
                    title="Copy invite link"
                    className={`flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-medium transition-all duration-200 ${
                      copied
                        ? 'bg-green-500/10 border-green-500/20 text-green-400'
                        : 'bg-surface border-dim text-secondary hover:bg-overlay hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <KeyRound size={11} className="text-accent" />
                  <span className="font-mono text-[10px] text-muted uppercase tracking-widest">PIN</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3.5 py-2 rounded bg-base border border-dim font-mono text-sm text-[var(--text-primary)] tracking-[0.3em] select-all">
                    {otp}
                  </div>
                  <button
                    onClick={copyOtp}
                    title="Copy PIN"
                    className={`flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-medium transition-all duration-200 ${
                      otpCopied
                        ? 'bg-green-500/10 border-green-500/20 text-green-400'
                        : 'bg-surface border-dim text-secondary hover:bg-overlay hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {otpCopied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              <button
                onClick={shareRoom}
                className={`flex items-center justify-center gap-1.5 w-full px-4 py-2 rounded border text-xs font-medium transition-all duration-200 ${
                  shareCopied
                    ? 'bg-green-500/10 border-green-500/20 text-green-400'
                    : 'bg-accent/10 border-accent/20 text-accent hover:bg-accent/20'
                }`}
              >
                {shareCopied ? <Check size={12} /> : <Share2 size={12} />}
                {shareCopied ? 'Copied link + PIN' : 'Share Room'}
              </button>
            </div>
          </div>

          {/* Upload policy */}
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-lg bg-raised border border-dim">
            <span className="font-mono text-[10px] text-muted uppercase tracking-widest shrink-0">Who can send files</span>
            <div className="flex flex-wrap gap-1.5 sm:ml-auto">
              <button
                onClick={() => handleSetUploadPolicy('owner-only')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  uploadPolicy === 'owner-only' ? 'bg-accent text-base' : 'bg-surface border border-dim text-secondary hover:bg-overlay'
                }`}
                style={uploadPolicy === 'owner-only' ? { color: '#0c0c0e' } : undefined}
              >
                Only me
              </button>
              <button
                onClick={() => handleSetUploadPolicy('anyone')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  uploadPolicy === 'anyone' ? 'bg-accent text-base' : 'bg-surface border border-dim text-secondary hover:bg-overlay'
                }`}
                style={uploadPolicy === 'anyone' ? { color: '#0c0c0e' } : undefined}
              >
                Anyone in the room
              </button>
            </div>
          </div>

          {/* Aggregate progress */}
          {aggregate && (
            <div className="mb-4 p-3.5 rounded-lg bg-raised border border-dim">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 justify-between mb-2">
                <span className="font-mono text-[10px] text-secondary">
                  Sending {aggregate.count} transfers &middot; {aggregate.pct}%
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

          {/* Files header */}
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-mono text-xs text-secondary uppercase tracking-wider">
                Payload
              </h2>
              {files.length > 0 && (
                <span className="font-mono text-[10px] text-muted px-1.5 py-0.5 rounded bg-surface border border-dim">
                  {files.length} file{files.length !== 1 ? 's' : ''} &middot; {formatBytes(totalSize)}
                </span>
              )}
            </div>
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

          {/* File drop / list */}
          {files.length === 0 ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center py-16 rounded-lg border-2 border-dashed cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-accent/40 bg-accent/[0.04]'
                  : 'border-dim hover:border-mid bg-raised/50'
              }`}
            >
              <div className="w-12 h-12 rounded-lg bg-surface border border-dim flex items-center justify-center mb-4">
                <Upload size={20} className="text-muted" />
              </div>
              <p className="text-sm text-secondary mb-1">Drop files here or click to browse</p>
              <p className="font-mono text-[10px] text-muted">any type &middot; no size limit</p>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`space-y-1.5 rounded-lg transition-all ${isDragging ? 'bg-accent/[0.03] ring-1 ring-accent/20' : ''}`}
            >
              <PayloadList
                files={files}
                transfers={uploader.transfers}
                transferKey={uploader.transferKey}
                downloads={downloader.downloads}
                recipients={receivers}
                onDownload={(fileId) => downloader.startDownload(roomId, fileId)}
                onRetryDownload={downloader.retry}
                onCancelDownload={downloader.cancel}
                onTogglePause={uploader.togglePause}
                onCancelUpload={uploader.handleCancelTransfer}
                onRetryUpload={uploader.handleRetryTransfer}
                onRemoveFile={removeFile}
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center py-2.5 rounded-lg border border-dashed border-dim cursor-pointer hover:border-mid transition-colors"
              >
                <span className="font-mono text-[10px] text-muted">+ drop or click to add more</span>
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Receivers */}
        <div className="w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-dim p-6 md:p-8 bg-raised/30">
          <div className="flex items-center gap-2 mb-5">
            <Users size={13} className="text-muted" />
            <span className="font-mono text-[10px] text-muted uppercase tracking-widest">
              Receivers
            </span>
            {receivers.length > 0 && (
              <span className="font-mono text-[10px] text-accent ml-auto">{receivers.length}</span>
            )}
          </div>

          {receivers.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-10 h-10 rounded-lg bg-surface border border-dim flex items-center justify-center mx-auto mb-3">
                <Users size={16} className="text-muted" />
              </div>
              <p className="text-xs text-muted mb-0.5">Waiting for peers</p>
              <p className="font-mono text-[10px] text-muted">Share the link to invite</p>
            </div>
          ) : (
            <div className="space-y-2">
              {receivers.map((r) => (
                <div key={r.socketId} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface border border-dim">
                  <div className="w-7 h-7 rounded bg-accent/10 border border-accent/20 flex items-center justify-center text-[10px] font-mono font-bold text-accent uppercase">
                    {r.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--text-primary)] truncate">{r.name}</p>
                    <p className="font-mono text-[9px] text-muted">connected</p>
                  </div>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Close room confirmation */}
      <Modal open={showCloseConfirm} onClose={() => setShowCloseConfirm(false)}>
        <h2 className="font-semibold text-sm mb-1">Close this room?</h2>
        <p className="text-xs text-muted mb-5">
          Everyone currently connected will be disconnected and returned to the home page.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCloseConfirm(false)}
            className="flex-1 py-2.5 rounded bg-surface border border-dim text-sm text-secondary hover:bg-overlay transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCloseRoom}
            className="flex-1 py-2.5 rounded bg-red-500/10 border border-red-500/20 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Close Room
          </button>
        </div>
      </Modal>
    </div>
  );
}
