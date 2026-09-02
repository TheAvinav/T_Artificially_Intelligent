import { useState, useRef, useCallback, useEffect } from 'react';
import socket from '../lib/socket';
import { useReceiverWebRTC, createSpeedTracker } from './useWebRTC';

// Handles the "I'm downloading a file that someone else in the room is
// hosting" side of a transfer. `files` is the full, current file list (used
// to look up a file's size for speed/ETA math) — pass the latest value on
// every render, it's read through a ref so this hook's callbacks stay stable.
export function useDownloader(files) {
  const [downloads, setDownloads] = useState({}); // fileId -> { status, receivedSize, speedBps, etaSeconds }

  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  const speedTrackers = useRef(new Map());

  const handleReceiverProgress = useCallback((fileId, receivedSize) => {
    const fileMeta = filesRef.current.find(f => f.fileId === fileId);
    const totalSize = fileMeta?.size || 0;

    if (!speedTrackers.current.has(fileId)) {
      speedTrackers.current.set(fileId, createSpeedTracker());
    }
    const { speedBps, etaSeconds } = speedTrackers.current.get(fileId).sample(receivedSize, totalSize);

    setDownloads(prev => ({
      ...prev,
      [fileId]: { ...prev[fileId], receivedSize, speedBps, etaSeconds }
    }));
  }, []);

  const handleFileReceived = useCallback((fileId, blob) => {
    const fileMeta = filesRef.current.find(f => f.fileId === fileId);
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

    speedTrackers.current.delete(fileId);
    setDownloads(prev => ({
      ...prev,
      [fileId]: { ...prev[fileId], status: 'complete', receivedSize: 0 }
    }));
  }, []);

  const handleStatusChange = useCallback((fileId, status) => {
    setDownloads(prev => ({
      ...prev,
      [fileId]: { ...prev[fileId], status }
    }));
  }, []);

  const { requestFile, retryDownload, cancelDownload, handleOffer, handleIceCandidate, cleanup } =
    useReceiverWebRTC(handleReceiverProgress, handleFileReceived, handleStatusChange);

  useEffect(() => {
    socket.on('webrtc-offer', handleOffer);
    socket.on('ice-candidate', handleIceCandidate);

    return () => {
      socket.off('webrtc-offer', handleOffer);
      socket.off('ice-candidate', handleIceCandidate);
      cleanup();
    };
  }, [handleOffer, handleIceCandidate, cleanup]);

  const startDownload = useCallback((roomId, fileId) => {
    setDownloads(prev => ({ ...prev, [fileId]: { status: 'connecting', receivedSize: 0 } }));
    requestFile(roomId, fileId);
  }, [requestFile]);

  const retry = useCallback((fileId) => {
    setDownloads(prev => ({ ...prev, [fileId]: { status: 'connecting', receivedSize: 0 } }));
    retryDownload(fileId);
  }, [retryDownload]);

  return { downloads, startDownload, retry, cancel: cancelDownload };
}
