import { useRef, useCallback } from 'react';
import socket from '../lib/socket';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

const CHUNK_SIZE = 64 * 1024; // 64KB chunks
const SPEED_WINDOW_MS = 3000; // window used to compute throughput
const SPEED_UPDATE_INTERVAL_MS = 2500; // how often the displayed speed/ETA is allowed to change

// Rolling-window throughput + ETA tracker, shared by sender and receiver.
// sample() is cheap to call on every chunk (progress % can update every time),
// but the returned speed/ETA numbers are only recomputed every
// SPEED_UPDATE_INTERVAL_MS — otherwise a 64KB chunk arriving every few
// milliseconds makes the displayed MB/s and "time left" jump around too fast
// to read.
export function createSpeedTracker() {
  const samples = []; // { t, bytes }
  let lastUpdate = 0;
  let lastResult = { speedBps: 0, etaSeconds: null };

  return {
    sample(totalBytesSoFar, totalBytes) {
      const now = Date.now();
      samples.push({ t: now, bytes: totalBytesSoFar });
      while (samples.length > 1 && now - samples[0].t > SPEED_WINDOW_MS) {
        samples.shift();
      }

      if (lastUpdate !== 0 && now - lastUpdate < SPEED_UPDATE_INTERVAL_MS) {
        return lastResult;
      }
      lastUpdate = now;

      const first = samples[0];
      const elapsed = (now - first.t) / 1000;
      const speedBps = elapsed > 0 ? (totalBytesSoFar - first.bytes) / elapsed : 0;
      const remaining = totalBytes - totalBytesSoFar;
      const etaSeconds = speedBps > 0 ? remaining / speedBps : null;

      lastResult = { speedBps, etaSeconds };
      return lastResult;
    }
  };
}

/**
 * Hook for the SENDER (room owner) side of WebRTC file transfer.
 * Manages peer connections per receiver+file pair.
 */
export function useSenderWebRTC(roomId, filesMapRef, onProgress, onComplete, onStatusChange) {
  // Map of `${receiverSocketId}-${fileId}` -> RTCPeerConnection
  const peerConnections = useRef(new Map());
  // Per-transfer mutable control state: offset, pause/cancel flags, speed tracker
  const transferState = useRef(new Map());

  const getKey = (receiverId, fileId) => `${receiverId}-${fileId}`;

  const setStatus = useCallback((fileId, receiverSocketId, status) => {
    if (onStatusChange) onStatusChange(fileId, receiverSocketId, status);
  }, [onStatusChange]);

  const closeConnection = (key) => {
    const pc = peerConnections.current.get(key);
    if (pc) {
      pc.close();
      peerConnections.current.delete(key);
    }
    transferState.current.delete(key);
  };

  // Called when a receiver requests a file
  const handleFileRequest = useCallback(({ fileId, receiverSocketId }) => {
    const key = getKey(receiverSocketId, fileId);

    closeConnection(key);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.current.set(key, pc);
    transferState.current.set(key, {
      offset: 0,
      paused: false,
      cancelled: false,
      speedTracker: createSpeedTracker()
    });

    setStatus(fileId, receiverSocketId, 'connecting');

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStatus(fileId, receiverSocketId, 'failed');
      }
    };

    // Create data channel
    const channel = pc.createDataChannel(`file-${fileId}`, {
      ordered: true,
    });

    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      // Find the actual File object from the filesMapRef
      const file = filesMapRef.current.get(fileId);
      if (!file) {
        console.error('File not found for id:', fileId);
        channel.close();
        setStatus(fileId, receiverSocketId, 'failed');
        return;
      }
      setStatus(fileId, receiverSocketId, 'transferring');
      sendFile(channel, file, fileId, receiverSocketId, key);
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          targetSocketId: receiverSocketId,
          candidate: event.candidate,
          fileId
        });
      }
    };

    // Create and send offer
    setStatus(fileId, receiverSocketId, 'negotiating');
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('webrtc-offer', {
          targetSocketId: receiverSocketId,
          offer: pc.localDescription,
          fileId
        });
      });

  }, [roomId, filesMapRef, setStatus]);

  // Re-run the whole offer/answer/ICE flow for a failed transfer
  const retryTransfer = useCallback((fileId, receiverSocketId) => {
    handleFileRequest({ fileId, receiverSocketId });
  }, [handleFileRequest]);

  // Handle answer from receiver
  const handleAnswer = useCallback(({ answer, fileId, receiverSocketId }) => {
    const key = getKey(receiverSocketId, fileId);
    const pc = peerConnections.current.get(key);
    if (pc) {
      pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }, []);

  // Handle ICE candidate from receiver
  const handleIceCandidate = useCallback(({ candidate, fileId, senderSocketId }) => {
    // For sender, the "senderSocketId" here is actually the receiver
    const key = getKey(senderSocketId, fileId);
    const pc = peerConnections.current.get(key);
    if (pc) {
      pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  const pauseTransfer = useCallback((receiverSocketId, fileId) => {
    const state = transferState.current.get(getKey(receiverSocketId, fileId));
    if (state) state.paused = true;
  }, []);

  const resumeTransfer = useCallback((receiverSocketId, fileId) => {
    const key = getKey(receiverSocketId, fileId);
    const state = transferState.current.get(key);
    if (!state || !state.paused) return;
    state.paused = false;

    const channel = state.channel;
    const file = filesMapRef.current.get(fileId);
    if (channel && file) {
      continueSending(channel, file, fileId, receiverSocketId, key);
    }
  }, [filesMapRef]);

  const cancelTransfer = useCallback((receiverSocketId, fileId) => {
    const key = getKey(receiverSocketId, fileId);
    const state = transferState.current.get(key);
    if (state) state.cancelled = true;
    setStatus(fileId, receiverSocketId, 'cancelled');
    closeConnection(key);
  }, [setStatus]);

  // Continue (or start) reading/sending chunks from the current offset.
  const continueSending = (channel, file, fileId, receiverSocketId, key) => {
    const state = transferState.current.get(key);
    if (!state) return;

    state.channel = channel;
    const totalSize = file.size;
    const reader = new FileReader();

    const readSlice = () => {
      const slice = file.slice(state.offset, state.offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      if (state.cancelled) return;

      const buffer = e.target.result;

      const send = () => {
        const current = transferState.current.get(key);
        if (!current || current.cancelled) return;
        if (current.paused) return; // resumeTransfer() will restart the loop

        if (channel.bufferedAmount > CHUNK_SIZE * 8) {
          setTimeout(send, 50);
          return;
        }

        channel.send(buffer);
        current.offset += buffer.byteLength;

        const progress = Math.min(100, Math.round((current.offset / totalSize) * 100));
        const { speedBps, etaSeconds } = current.speedTracker.sample(current.offset, totalSize);

        if (onProgress) {
          onProgress(fileId, receiverSocketId, progress, { speedBps, etaSeconds });
        }

        if (current.offset < totalSize) {
          readSlice();
        } else {
          // Done
          channel.send(JSON.stringify({ done: true, fileId }));
          setStatus(fileId, receiverSocketId, 'complete');
          if (onComplete) {
            onComplete(fileId, receiverSocketId);
          }

          // Cleanup after short delay
          setTimeout(() => closeConnection(key), 2000);
        }
      };

      send();
    };

    readSlice();
  };

  // Send file over data channel in chunks (fresh start)
  const sendFile = (channel, file, fileId, receiverSocketId, key) => {
    continueSending(channel, file, fileId, receiverSocketId, key);
  };

  const cleanup = useCallback(() => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    transferState.current.clear();
  }, []);

  return {
    handleFileRequest,
    handleAnswer,
    handleIceCandidate,
    retryTransfer,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    cleanup
  };
}


/**
 * Hook for the RECEIVER side of WebRTC file transfer.
 */
export function useReceiverWebRTC(onProgress, onFileReceived, onStatusChange) {
  const peerConnections = useRef(new Map());
  const pendingRequests = useRef(new Map()); // fileId -> roomId, for retry

  const setStatus = useCallback((fileId, status) => {
    if (onStatusChange) onStatusChange(fileId, status);
  }, [onStatusChange]);

  // Request a file from the owner
  const requestFile = useCallback((roomId, fileId) => {
    pendingRequests.current.set(fileId, roomId);
    setStatus(fileId, 'connecting');
    socket.emit('request-file', { roomId, fileId });
  }, [setStatus]);

  const retryDownload = useCallback((fileId) => {
    const roomId = pendingRequests.current.get(fileId);
    if (roomId) requestFile(roomId, fileId);
  }, [requestFile]);

  const cancelDownload = useCallback((fileId) => {
    const roomId = pendingRequests.current.get(fileId);
    const pc = peerConnections.current.get(fileId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(fileId);
    }
    if (roomId) {
      socket.emit('cancel-transfer', { roomId, fileId });
    }
    setStatus(fileId, 'cancelled');
  }, [setStatus]);

  // Handle offer from sender
  const handleOffer = useCallback(({ offer, fileId, senderSocketId }) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.current.set(fileId, pc);

    setStatus(fileId, 'negotiating');

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStatus(fileId, 'failed');
      }
    };

    // Receive data channel
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      channel.binaryType = 'arraybuffer';

      const chunks = [];
      let receivedSize = 0;

      channel.onopen = () => {
        setStatus(fileId, 'transferring');
      };

      channel.onmessage = (e) => {
        if (typeof e.data === 'string') {
          try {
            const msg = JSON.parse(e.data);
            if (msg.done) {
              // All chunks received — assemble blob
              const blob = new Blob(chunks);
              setStatus(fileId, 'complete');
              if (onFileReceived) {
                onFileReceived(fileId, blob);
              }

              // Cleanup
              setTimeout(() => {
                pc.close();
                peerConnections.current.delete(fileId);
              }, 2000);
            }
          } catch (err) {
            // Not JSON, treat as data
          }
          return;
        }

        chunks.push(e.data);
        receivedSize += e.data.byteLength;

        // Total size isn't known inside this hook (only file metadata held
        // by the page component knows it) — the page derives speed/ETA
        // itself from the receivedSize deltas this callback reports.
        if (onProgress) {
          onProgress(fileId, receivedSize);
        }
      };
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          targetSocketId: senderSocketId,
          candidate: event.candidate,
          fileId
        });
      }
    };

    pc.setRemoteDescription(new RTCSessionDescription(offer))
      .then(() => pc.createAnswer())
      .then(answer => pc.setLocalDescription(answer))
      .then(() => {
        socket.emit('webrtc-answer', {
          targetSocketId: senderSocketId,
          answer: pc.localDescription,
          fileId
        });
      });

  }, [onProgress, onFileReceived, setStatus]);

  // Handle ICE candidate from sender
  const handleIceCandidate = useCallback(({ candidate, fileId }) => {
    const pc = peerConnections.current.get(fileId);
    if (pc) {
      pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  const cleanup = useCallback(() => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
  }, []);

  return {
    requestFile,
    retryDownload,
    cancelDownload,
    handleOffer,
    handleIceCandidate,
    cleanup
  };
}
