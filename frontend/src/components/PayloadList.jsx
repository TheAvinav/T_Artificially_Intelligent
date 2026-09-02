import {
  Download, File, Image, Video, Music, FileText, Archive,
  CheckCircle2, Loader2, X, RotateCcw, CheckSquare, Square, Pause, PlayIcon
} from 'lucide-react';
import { formatBytes, formatSpeed, formatDuration } from '../lib/utils';

const FILE_ICONS = {
  file: File, image: Image, video: Video, music: Music,
  'file-text': FileText, archive: Archive,
};

const ACTIVE_STATUSES = ['connecting', 'negotiating', 'transferring'];
const STATUS_LABELS = {
  connecting: 'connecting…',
  negotiating: 'negotiating…',
  transferring: null, // shows live % instead
  failed: 'failed',
  cancelled: 'cancelled',
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

// Renders the shared "who has what file" list used by both the owner's and
// a regular participant's room view. A file is either one the current user
// uploaded (`mine`, shows per-recipient send progress) or one someone else
// uploaded (shows a receive/download control).
export default function PayloadList({
  files,
  transfers,
  transferKey,
  downloads,
  recipients,
  onDownload,
  onRetryDownload,
  onCancelDownload,
  onTogglePause,
  onCancelUpload,
  onRetryUpload,
  onRemoveFile,
  selected,
  onToggleSelect,
}) {
  if (files.length === 0) return null;

  return (
    <div className="space-y-1.5 stagger">
      {files.map((f) => {
        const iconType = getIconType(f.type);
        const FileIcon = FILE_ICONS[iconType] || File;

        if (f.mine) {
          return (
            <OwnFileRow
              key={f.fileId}
              file={f}
              FileIcon={FileIcon}
              transfers={transfers}
              transferKey={transferKey}
              recipients={recipients}
              onTogglePause={onTogglePause}
              onCancelUpload={onCancelUpload}
              onRetryUpload={onRetryUpload}
              onRemoveFile={onRemoveFile}
            />
          );
        }

        return (
          <OtherFileRow
            key={f.fileId}
            file={f}
            FileIcon={FileIcon}
            status={downloads[f.fileId]}
            isSelected={selected?.has(f.fileId)}
            onToggleSelect={onToggleSelect}
            onDownload={onDownload}
            onRetryDownload={onRetryDownload}
            onCancelDownload={onCancelDownload}
          />
        );
      })}
    </div>
  );
}

function OwnFileRow({ file, FileIcon, transfers, transferKey, recipients, onTogglePause, onCancelUpload, onRetryUpload, onRemoveFile }) {
  const activeRecipients = recipients.filter(r => transfers[transferKey(file.fileId, r.socketId)]);

  return (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-raised border border-dim group hover:border-mid transition-colors">
      <div className="w-8 h-8 rounded bg-surface border border-dim flex items-center justify-center shrink-0">
        <FileIcon size={14} className="text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--text-primary)] truncate">{file.name}</p>
        <p className="font-mono text-[10px] text-muted">{formatBytes(file.size)} &middot; <span className="text-accent">sent by you</span></p>
      </div>

      <div className="flex items-center gap-3 flex-wrap justify-end">
        {activeRecipients.length === 0 && onRemoveFile && (
          <button
            onClick={() => onRemoveFile(file.fileId)}
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted hover:text-secondary transition-all"
          >
            <X size={13} />
          </button>
        )}
        {recipients.map(r => {
          const t = transfers[transferKey(file.fileId, r.socketId)];
          if (!t) return null;
          const isActive = ACTIVE_STATUSES.includes(t.status);
          const isComplete = t.status === 'complete';
          const isFailed = t.status === 'failed';
          const prog = t.progress || 0;
          const name = r.name;

          return (
            <div key={r.socketId} className="flex items-center gap-1.5" title={name}>
              {isActive && (
                <>
                  <div className="w-14 h-1 rounded-full bg-dim overflow-hidden">
                    <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${prog}%` }} />
                  </div>
                  <span className="font-mono text-[9px] w-6 text-right text-muted">
                    {t.status === 'transferring' ? `${prog}%` : '···'}
                  </span>
                  {t.status === 'transferring' && t.speedBps > 0 && (
                    <span className="font-mono text-[9px] text-muted hidden md:inline">{formatSpeed(t.speedBps)}</span>
                  )}
                  <button onClick={() => onTogglePause(file.fileId, r.socketId)} title={t.paused ? 'Resume' : 'Pause'} className="p-1 rounded text-muted hover:text-accent transition-colors">
                    {t.paused ? <PlayIcon size={11} /> : <Pause size={11} />}
                  </button>
                  <button onClick={() => onCancelUpload(file.fileId, r.socketId)} title="Cancel" className="p-1 rounded text-muted hover:text-red-400 transition-colors">
                    <X size={11} />
                  </button>
                </>
              )}
              {isComplete && <span className="font-mono text-[9px] text-green-500">✓ {name}</span>}
              {isFailed && (
                <button onClick={() => onRetryUpload(file.fileId, r.socketId)} title="Retry" className="flex items-center gap-1 font-mono text-[9px] text-red-400 hover:text-red-300">
                  <RotateCcw size={10} /> retry
                </button>
              )}
            </div>
          );
        })}
        {activeRecipients.length === 0 && recipients.length === 0 && (
          <span className="font-mono text-[9px] text-muted">waiting for peers</span>
        )}
      </div>
    </div>
  );
}

function OtherFileRow({ file, FileIcon, status, isSelected, onToggleSelect, onDownload, onRetryDownload, onCancelDownload }) {
  const isActive = status && ACTIVE_STATUSES.includes(status.status);
  const isComplete = status?.status === 'complete';
  const isFailed = status?.status === 'failed';
  const isCancelled = status?.status === 'cancelled';
  const isIdle = !status || isFailed || isCancelled;

  let progressPct = 0;
  if (isActive && file.size > 0 && status.receivedSize) {
    progressPct = Math.min(99, Math.round((status.receivedSize / file.size) * 100));
  }
  if (isComplete) progressPct = 100;

  return (
    <div className="flex items-center gap-3 px-3.5 py-3.5 rounded-lg bg-raised border border-dim group hover:border-mid transition-all">
      {isIdle && onToggleSelect && (
        <button onClick={() => onToggleSelect(file.fileId)} className="text-muted hover:text-accent shrink-0">
          {isSelected ? <CheckSquare size={16} className="text-accent" /> : <Square size={16} />}
        </button>
      )}
      <div className="w-9 h-9 rounded bg-surface border border-dim flex items-center justify-center shrink-0">
        <FileIcon size={15} className="text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--text-primary)] truncate">{file.name}</p>
        <p className="font-mono text-[10px] text-muted">
          {formatBytes(file.size)}
          {file.senderName && <> &middot; <span className="text-secondary">from {file.senderName}</span></>}
          {isActive && status.speedBps > 0 && (
            <> &middot; {formatSpeed(status.speedBps)} &middot; {formatDuration(status.etaSeconds)}</>
          )}
          {isFailed && <span className="text-red-400"> &middot; transfer failed</span>}
          {isCancelled && <span className="text-muted"> &middot; cancelled</span>}
        </p>
        {isActive && (
          <div className="mt-2 w-full h-1 rounded-full bg-dim overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      {isComplete ? (
        <div className="flex items-center gap-1.5 text-green-500">
          <CheckCircle2 size={14} />
          <span className="font-mono text-[10px] font-medium">done</span>
        </div>
      ) : isActive ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-accent">
            <Loader2 size={14} className="animate-spin" />
            <span className="font-mono text-[10px] font-medium">
              {status.status === 'transferring' ? `${progressPct}%` : STATUS_LABELS[status.status]}
            </span>
          </div>
          <button onClick={() => onCancelDownload(file.fileId)} title="Cancel" className="p-1 rounded text-muted hover:text-red-400 transition-colors">
            <X size={13} />
          </button>
        </div>
      ) : isFailed ? (
        <button
          onClick={() => onRetryDownload(file.fileId)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
        >
          <RotateCcw size={12} /> Retry
        </button>
      ) : (
        <button
          onClick={() => onDownload(file.fileId)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-accent bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors"
        >
          <Download size={12} /> Receive
        </button>
      )}
    </div>
  );
}

