import { useState, useRef, useCallback, useEffect } from 'react';
import socket from '../lib/socket';
import { useSenderWebRTC } from './useWebRTC';

const key = (fileId, receiverSocketId) => `${fileId}-${receiverSocketId}`;

// Handles the "I'm hosting a file and sending it to whoever requests it"
// side of a transfer. Usable by any room participant — the owner or, when
// the room's upload policy allows it, a regular receiver.
export function useUploader(roomId) {
  const [transfers, setTransfers] = useState({}); // key(fileId, receiverSocketId) -> { progress, status, speedBps, etaSeconds, paused }
  const filesMapRef = useRef(new Map());

  const handleProgress = useCallback((fileId, receiverSocketId, progress, stats = {}) => {
    setTransfers(prev => ({
      ...prev,
      [key(fileId, receiverSocketId)]: {
        ...prev[key(fileId, receiverSocketId)],
        progress,
        speedBps: stats.speedBps,
        etaSeconds: stats.etaSeconds,
        status: 'transferring'
      }
    }));
  }, []);

  const handleComplete = useCallback((fileId, receiverSocketId) => {
    setTransfers(prev => ({
      ...prev,
      [key(fileId, receiverSocketId)]: { ...prev[key(fileId, receiverSocketId)], progress: 100, status: 'complete' }
    }));
  }, []);

  const handleStatusChange = useCallback((fileId, receiverSocketId, status) => {
    setTransfers(prev => ({
      ...prev,
      [key(fileId, receiverSocketId)]: { ...prev[key(fileId, receiverSocketId)], status }
    }));
  }, []);

  const { handleFileRequest, handleAnswer, handleIceCandidate, retryTransfer, pauseTransfer, resumeTransfer, cancelTransfer, cleanup } =
    useSenderWebRTC(roomId, filesMapRef, handleProgress, handleComplete, handleStatusChange);

  useEffect(() => {
    const onFileRequested = (data) => {
      setTransfers(prev => ({
        ...prev,
        [key(data.fileId, data.receiverSocketId)]: { progress: 0, status: 'connecting' }
      }));
      handleFileRequest(data);
    };
    const onCancel = ({ fileId, receiverSocketId }) => cancelTransfer(receiverSocketId, fileId);

    socket.on('file-requested', onFileRequested);
    socket.on('webrtc-answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('cancel-transfer', onCancel);

    return () => {
      socket.off('file-requested', onFileRequested);
      socket.off('webrtc-answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('cancel-transfer', onCancel);
      cleanup();
    };
  }, [handleFileRequest, handleAnswer, handleIceCandidate, cancelTransfer, cleanup]);

  // Sends file-metadata for a fresh batch of files and, once the server
  // acks with generated fileIds, registers the real File objects locally
  // and hands the ack'd entries to the caller to merge into its file list.
  const uploadFiles = useCallback((fileList, onAck) => {
    const newFiles = Array.from(fileList);
    const metadata = newFiles.map(f => ({ name: f.webkitRelativePath || f.name, size: f.size, type: f.type }));
    socket.emit('file-metadata', { roomId, files: metadata });
    const handleAck = (ackFiles) => {
      ackFiles.forEach((ack, i) => {
        filesMapRef.current.set(ack.fileId, newFiles[i]);
      });
      onAck(ackFiles);
      socket.off('metadata-ack', handleAck);
    };
    socket.on('metadata-ack', handleAck);
  }, [roomId]);

  const removeFile = useCallback((fileId) => {
    filesMapRef.current.delete(fileId);
  }, []);

  const togglePause = (fileId, receiverSocketId) => {
    const state = transfers[key(fileId, receiverSocketId)];
    if (state?.paused) {
      resumeTransfer(receiverSocketId, fileId);
      setTransfers(prev => ({ ...prev, [key(fileId, receiverSocketId)]: { ...prev[key(fileId, receiverSocketId)], paused: false } }));
    } else {
      pauseTransfer(receiverSocketId, fileId);
      setTransfers(prev => ({ ...prev, [key(fileId, receiverSocketId)]: { ...prev[key(fileId, receiverSocketId)], paused: true } }));
    }
  };

  const handleCancelTransfer = (fileId, receiverSocketId) => {
    cancelTransfer(receiverSocketId, fileId);
  };

  const handleRetryTransfer = (fileId, receiverSocketId) => {
    setTransfers(prev => ({ ...prev, [key(fileId, receiverSocketId)]: { progress: 0, status: 'connecting' } }));
    retryTransfer(fileId, receiverSocketId);
  };

  return {
    transfers,
    uploadFiles,
    removeFile,
    togglePause,
    handleCancelTransfer,
    handleRetryTransfer,
    transferKey: key
  };
}
