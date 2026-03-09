import { useRef, useCallback } from 'react';
import socket from '../lib/socket';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

const CHUNK_SIZE = 64 * 1024; // 64KB chunks

/**
 * Hook for the SENDER (room owner) side of WebRTC file transfer.
 * Manages peer connections per receiver+file pair.
 */
export function useSenderWebRTC(roomId, filesMapRef, onProgress, onComplete) {
  // Map of `${receiverSocketId}-${fileId}` -> RTCPeerConnection
  const peerConnections = useRef(new Map());

  const getKey = (receiverId, fileId) => `${receiverId}-${fileId}`;

  // Called when a receiver requests a file
  const handleFileRequest = useCallback(({ fileId, receiverSocketId }) => {
    const key = getKey(receiverSocketId, fileId);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.current.set(key, pc);

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
        return;
      }
      sendFile(channel, file, fileId, receiverSocketId);
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
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('webrtc-offer', {
          targetSocketId: receiverSocketId,
          offer: pc.localDescription,
          fileId
        });
      });

  }, [roomId, filesMapRef]);

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

  // Send file over data channel in chunks
  const sendFile = (channel, file, fileId, receiverSocketId) => {
    const totalSize = file.size;
    let offset = 0;

    const reader = new FileReader();

    const readSlice = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const buffer = e.target.result;

      // Wait for bufferedAmount to drain if needed
      const send = () => {
        if (channel.bufferedAmount > CHUNK_SIZE * 8) {
          setTimeout(send, 50);
          return;
        }

        channel.send(buffer);
        offset += buffer.byteLength;

        const progress = Math.min(100, Math.round((offset / totalSize) * 100));

        // Report progress
        if (onProgress) {
          onProgress(fileId, receiverSocketId, progress);
        }
        socket.emit('transfer-progress', {
          roomId,
          fileId,
          receiverSocketId,
          progress
        });

        if (offset < totalSize) {
          readSlice();
        } else {
          // Done
          channel.send(JSON.stringify({ done: true, fileId }));
          if (onComplete) {
            onComplete(fileId, receiverSocketId);
          }
          socket.emit('transfer-complete', {
            roomId,
            fileId,
            receiverSocketId
          });

          // Cleanup after short delay
          setTimeout(() => {
            const key = getKey(receiverSocketId, fileId);
            const pc = peerConnections.current.get(key);
            if (pc) {
              pc.close();
              peerConnections.current.delete(key);
            }
          }, 2000);
        }
      };

      send();
    };

    readSlice();
  };

  const cleanup = useCallback(() => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
  }, []);

  return {
    handleFileRequest,
    handleAnswer,
    handleIceCandidate,
    cleanup
  };
}


/**
 * Hook for the RECEIVER side of WebRTC file transfer.
 */
export function useReceiverWebRTC(onProgress, onFileReceived) {
  const peerConnections = useRef(new Map());

  // Request a file from the owner
  const requestFile = useCallback((roomId, fileId) => {
    socket.emit('request-file', { roomId, fileId });
  }, []);

  // Handle offer from sender
  const handleOffer = useCallback(({ offer, fileId, senderSocketId }) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.current.set(fileId, pc);

    // Receive data channel
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      channel.binaryType = 'arraybuffer';

      const chunks = [];
      let receivedSize = 0;

      channel.onmessage = (e) => {
        if (typeof e.data === 'string') {
          try {
            const msg = JSON.parse(e.data);
            if (msg.done) {
              // All chunks received — assemble blob
              const blob = new Blob(chunks);
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

  }, [onProgress, onFileReceived]);

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
    handleOffer,
    handleIceCandidate,
    cleanup
  };
}
