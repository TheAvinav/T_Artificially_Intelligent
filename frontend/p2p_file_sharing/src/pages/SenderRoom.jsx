import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import {
  Copy, Check, Plus, File, Image, Video, Music,
  FileText, Archive, Users, Upload, X, Send, Link2
} from 'lucide-react';
import socket from '../lib/socket';
import { formatBytes, truncate } from '../lib/utils';
import { useSenderWebRTC } from '../hooks/useWebRTC';

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

export default function SenderRoom() {
  const { roomId } = useParams();
  const location = useLocation();
  const senderName = location.state?.name || 'You';

  const [copied, setCopied] = useState(false);
  const [receivers, setReceivers] = useState([]);
  const [files, setFiles] = useState([]);
  const [transferProgress, setTransferProgress] = useState({});
  const [isDragging, setIsDragging] = useState(false);

  const filesMapRef = useRef(new Map());
  const fileInputRef = useRef(null);

  const handleProgress = useCallback((fileId, receiverSocketId, progress) => {
    setTransferProgress(prev => ({
      ...prev,
      [`${fileId}-${receiverSocketId}`]: progress
    }));
  }, []);

  const handleComplete = useCallback((fileId, receiverSocketId) => {
    setTransferProgress(prev => ({
      ...prev,
      [`${fileId}-${receiverSocketId}`]: 100
    }));
  }, []);

  const { handleFileRequest, handleAnswer, handleIceCandidate, cleanup } =
    useSenderWebRTC(roomId, filesMapRef, handleProgress, handleComplete);

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

    socket.on('file-requested', handleFileRequest);
    socket.on('webrtc-answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);

    socket.on('transfer-progress', ({ fileId, receiverSocketId, progress }) => {
      handleProgress(fileId, receiverSocketId, progress);
    });

    socket.on('transfer-complete', ({ fileId, receiverSocketId }) => {
      handleComplete(fileId, receiverSocketId);
    });

    return () => {
      socket.off('receiver-joined');
      socket.off('receiver-left');
      socket.off('metadata-ack');
      socket.off('file-requested');
      socket.off('webrtc-answer');
      socket.off('ice-candidate');
      socket.off('transfer-progress');
      socket.off('transfer-complete');
      cleanup();
    };
  }, [handleFileRequest, handleAnswer, handleIceCandidate, handleProgress, handleComplete, cleanup]);

  const shareLink = `${window.location.origin}/room/${roomId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addFiles = (fileList) => {
    const newFiles = Array.from(fileList);
    const metadata = newFiles.map(f => ({ name: f.name, size: f.size, type: f.type }));
    socket.emit('file-metadata', { roomId, files: metadata });
    const handleAck = (ackFiles) => {
      ackFiles.forEach((ack, i) => {
        const file = newFiles[i];
        filesMapRef.current.set(ack.fileId, file);
        setFiles(prev => [...prev, { ...ack, file }]);
      });
      socket.off('metadata-ack', handleAck);
    };
    socket.on('metadata-ack', handleAck);
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
    filesMapRef.current.delete(fileId);
  };

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="scanline-bg grain min-h-screen flex flex-col">
      {/* Header */}
      <nav className="flex items-center justify-between px-6 py-3.5 md:px-8 border-b border-dim">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-accent/10 border border-accent/20 flex items-center justify-center">
            <span className="text-accent font-mono text-[10px] font-bold">W</span>
          </div>
          <span className="font-mono text-xs text-muted">/</span>
          <span className="font-mono text-xs text-secondary">room</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded bg-surface border border-dim">
            <Send size={10} className="text-accent" />
            <span className="font-mono text-[10px] text-secondary">
              Sending as <span className="text-[var(--text-primary)] font-medium">{senderName}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="font-mono text-[10px] text-muted">live</span>
          </div>
        </div>
      </nav>

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left panel */}
        <div className="flex-1 p-6 md:p-8 lg:p-10">
          {/* Share link */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2.5">
              <Link2 size={12} className="text-accent" />
              <span className="font-mono text-[10px] text-muted uppercase tracking-widest">Invite Link</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3.5 py-2.5 rounded bg-base border border-dim font-mono text-[11px] text-muted truncate select-all">
                {shareLink}
              </div>
              <button
                onClick={copyLink}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded border text-xs font-medium transition-all duration-200 ${
                  copied
                    ? 'bg-green-500/10 border-green-500/20 text-green-400'
                    : 'bg-surface border-dim text-secondary hover:bg-overlay hover:text-[var(--text-primary)]'
                }`}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Files header */}
          <div className="mb-4 flex items-center justify-between">
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
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
            >
              <Plus size={13} /> Add
            </button>
            <input ref={fileInputRef} type="file" multiple onChange={handleFileInput} className="hidden" />
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
              {files.map((f, idx) => {
                const iconType = getIconType(f.type);
                const FileIcon = FILE_ICONS[iconType] || File;
                return (
                  <div
                    key={f.fileId}
                    className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-raised border border-dim group hover:border-mid transition-colors"
                    style={{ animationDelay: `${idx * 40}ms` }}
                  >
                    <div className="w-8 h-8 rounded bg-surface border border-dim flex items-center justify-center shrink-0">
                      <FileIcon size={14} className="text-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">{f.name}</p>
                      <p className="font-mono text-[10px] text-muted">{formatBytes(f.size)}</p>
                    </div>

                    {/* Progress per receiver */}
                    <div className="flex items-center gap-2">
                      {receivers.map(r => {
                        const key = `${f.fileId}-${r.socketId}`;
                        const prog = transferProgress[key];
                        if (prog === undefined) return null;
                        const done = prog >= 100;
                        return (
                          <div key={r.socketId} className="flex items-center gap-1.5" title={`${r.name}: ${prog}%`}>
                            <div className="w-14 h-1 rounded-full bg-dim overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-green-500' : 'bg-accent'}`}
                                style={{ width: `${prog}%` }}
                              />
                            </div>
                            <span className={`font-mono text-[9px] w-6 text-right ${done ? 'text-green-500' : 'text-muted'}`}>
                              {done ? '✓' : `${prog}%`}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => removeFile(f.fileId)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted hover:text-secondary transition-all"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}

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

          {/* Transfer log */}
          {receivers.length > 0 && files.length > 0 && (
            <div className="mt-6 pt-5 border-t border-dim">
              <span className="font-mono text-[10px] text-muted uppercase tracking-widest block mb-3">Transfer Log</span>
              <div className="space-y-2.5">
                {receivers.map(r => {
                  const fileProgresses = files.map(f => {
                    const key = `${f.fileId}-${r.socketId}`;
                    return { name: f.name, progress: transferProgress[key] };
                  }).filter(fp => fp.progress !== undefined);

                  if (fileProgresses.length === 0) return null;

                  return (
                    <div key={r.socketId} className="space-y-1">
                      <p className="font-mono text-[10px] text-secondary">{r.name}</p>
                      {fileProgresses.map((fp, i) => {
                        const done = fp.progress >= 100;
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <p className="font-mono text-[9px] text-muted truncate flex-1">{truncate(fp.name, 18)}</p>
                            <div className="w-12 h-0.5 rounded-full bg-dim">
                              <div
                                className={`h-full rounded-full ${done ? 'bg-green-500' : 'bg-accent'}`}
                                style={{ width: `${fp.progress}%` }}
                              />
                            </div>
                            <span className={`font-mono text-[9px] w-6 text-right ${done ? 'text-green-500' : 'text-muted'}`}>
                              {done ? '✓' : `${fp.progress}%`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}