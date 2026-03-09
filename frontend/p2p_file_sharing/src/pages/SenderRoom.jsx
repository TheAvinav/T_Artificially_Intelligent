import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation} from 'react-router-dom';
import {
  Radio, Copy, Check, Plus, File, Image, Video, Music,
  FileText, Archive, Users, Upload, X, ChevronDown
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
//   const navigate = useNavigate();
  const senderName = location.state?.name || 'You';

  const [copied, setCopied] = useState(false);
  const [receivers, setReceivers] = useState([]);
  const [files, setFiles] = useState([]); // { fileId, name, size, type, file (File object) }
  const [transferProgress, setTransferProgress] = useState({}); // { `${fileId}-${receiverId}`: progress }
  const [isDragging, setIsDragging] = useState(false);

  // Map of fileId -> actual File object (for WebRTC sending)
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

    // socket.on('metadata-ack', (newFiles) => {
    //   // Server acknowledged and returned fileIds
    //   // We already added them optimistically, but update with server fileIds
    // });

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

    // Emit metadata to server
    socket.emit('file-metadata', { roomId, files: metadata });

    // Listen for metadata-ack to get fileIds
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

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <nav className="flex items-center justify-between px-6 py-4 md:px-10 border-b border-surface-3">
        <div className="flex items-center gap-2">
          <Radio className="text-accent" size={20} />
          <span className="font-display font-bold text-sm tracking-tight">warp</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
            Sending as <span className="text-zinc-300 font-medium">{senderName}</span>
          </div>
        </div>
      </nav>

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left: Files panel */}
        <div className="flex-1 p-6 md:p-10">
          {/* Share link bar */}
          <div className="mb-8">
            <p className="text-xs text-zinc-500 font-medium mb-2 uppercase tracking-wider">Share this link</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-4 py-2.5 rounded-lg bg-surface-1 border border-surface-3 text-sm text-zinc-400 truncate font-mono text-xs">
                {shareLink}
              </div>
              <button
                onClick={copyLink}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-surface-2 border border-surface-4 text-sm text-zinc-300 hover:bg-surface-3 transition-colors shrink-0"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Drop zone / file list */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">
              Files {files.length > 0 && <span className="text-zinc-500 font-normal">({files.length})</span>}
            </h2>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
            >
              <Plus size={14} /> Add Files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileInput}
              className="hidden"
            />
          </div>

          {files.length === 0 ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center py-20 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-accent/50 bg-accent/5'
                  : 'border-surface-4 hover:border-zinc-600 bg-surface-1/50'
              }`}
            >
              <Upload size={32} className="text-zinc-600 mb-3" />
              <p className="text-sm text-zinc-400 mb-1">Drop files here or click to browse</p>
              <p className="text-xs text-zinc-600">Any file type, no size limit</p>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`space-y-2 p-1 rounded-2xl transition-all ${isDragging ? 'bg-accent/5 ring-2 ring-accent/20' : ''}`}
            >
              {files.map((f) => {
                const iconType = getIconType(f.type);
                const Icon = FILE_ICONS[iconType] || File;
                return (
                  <div key={f.fileId} className="flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-surface-3 group">
                    <div className="w-9 h-9 rounded-lg bg-surface-3 flex items-center justify-center shrink-0">
                      <Icon size={16} className="text-zinc-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{f.name}</p>
                      <p className="text-xs text-zinc-500">{formatBytes(f.size)}</p>
                    </div>

                    {/* Per-receiver progress for this file */}
                    <div className="flex items-center gap-1">
                      {receivers.map(r => {
                        const key = `${f.fileId}-${r.socketId}`;
                        const prog = transferProgress[key];
                        if (prog === undefined) return null;
                        return (
                          <div key={r.socketId} className="flex items-center gap-1" title={`${r.name}: ${prog}%`}>
                            <div className="w-16 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${prog >= 100 ? 'bg-emerald-400' : 'bg-accent'}`}
                                style={{ width: `${prog}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-zinc-500 w-7 text-right">{prog}%</span>
                          </div>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => removeFile(f.fileId)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-500 hover:text-zinc-300 transition-all"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}

              {/* Drag hint */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center py-3 rounded-xl border border-dashed border-surface-4 cursor-pointer hover:border-zinc-600 transition-colors"
              >
                <p className="text-xs text-zinc-500">Drop more files or click to add</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Receivers panel */}
        <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-surface-3 p-6 md:p-8">
          <div className="flex items-center gap-2 mb-5">
            <Users size={16} className="text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-300">
              Receivers
              {receivers.length > 0 && (
                <span className="ml-1.5 text-zinc-500 font-normal">({receivers.length})</span>
              )}
            </h2>
          </div>

          {receivers.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-surface-2 border border-surface-4 flex items-center justify-center mx-auto mb-3">
                <Users size={20} className="text-zinc-600" />
              </div>
              <p className="text-sm text-zinc-500 mb-1">No one here yet</p>
              <p className="text-xs text-zinc-600">Share the link above to invite people</p>
            </div>
          ) : (
            <div className="space-y-2">
              {receivers.map((r) => (
                <div
                  key={r.socketId}
                  className="flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-surface-3"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/30 to-cyan-600/30 flex items-center justify-center text-xs font-bold text-accent uppercase">
                    {r.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200 truncate">{r.name}</p>
                    <p className="text-[11px] text-zinc-500">Connected</p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>
              ))}
            </div>
          )}

          {/* Transfer summary */}
          {receivers.length > 0 && files.length > 0 && (
            <div className="mt-6 pt-6 border-t border-surface-3">
              <h3 className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-3">Transfer Status</h3>
              <div className="space-y-3">
                {receivers.map(r => {
                  const fileProgresses = files.map(f => {
                    const key = `${f.fileId}-${r.socketId}`;
                    return { name: f.name, progress: transferProgress[key] };
                  }).filter(fp => fp.progress !== undefined);

                  if (fileProgresses.length === 0) return null;

                  return (
                    <div key={r.socketId} className="space-y-1.5">
                      <p className="text-xs text-zinc-400 font-medium">{r.name}</p>
                      {fileProgresses.map((fp, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <p className="text-[11px] text-zinc-500 truncate flex-1">{truncate(fp.name, 20)}</p>
                          <div className="w-20 h-1 rounded-full bg-surface-3">
                            <div
                              className={`h-full rounded-full ${fp.progress >= 100 ? 'bg-emerald-400' : 'bg-accent'}`}
                              style={{ width: `${fp.progress}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-zinc-500 w-7 text-right">{fp.progress}%</span>
                        </div>
                      ))}
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