require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const {
  createRoom,
  joinRoom,
  addMetadata,
  findFileMeta,
  getRoom,
  touchRoom,
  verifyOtp,
  findRoomBySocket,
  removeSocket,
  removeReceiver,
  removeFilesBySender,
  deleteRoom,
  reclaimOwnership,
  sweepIdleRooms,
  isParticipant,
  canUpload,
  setUploadPolicy,
  findParticipantName
} = require("./room");

const { checkLimit } = require("./rateLimiter");

const {
  createRoomSchema,
  joinRoomSchema,
  fileMetadataSchema,
  requestFileSchema,
  webrtcOfferSchema,
  webrtcAnswerSchema,
  iceCandidateSchema,
  reclaimRoomSchema,
  roomOnlySchema,
  setUploadPolicySchema
} = require("./schemas");

// Comma-separated list of origins allowed to talk to this server. Only
// matters for cross-origin setups (local split dev: Vite on :5173 talking
// to the API on :3000, or a frontend hosted separately from this backend).
// When this backend serves the built frontend itself (the normal production
// setup — see the static-file block below), requests are same-origin and
// this is never consulted by the browser at all.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const ALLOWED_ORIGINS = FRONTEND_URL.split(",").map(o => o.trim()).filter(Boolean);

const PORT = process.env.PORT || 3000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SWEEP_INTERVAL_MS = 60 * 1000;
const OWNER_GRACE_MS = 45 * 1000; // time the owner has to reconnect after a drop before the room closes for real

// The shareable room link should point wherever the browser actually loaded
// this app from — that's correct whether you're on localhost, a Render URL,
// or a custom domain, with zero extra config. Falls back to FRONTEND_URL
// for the rare case a client connects without an Origin header.
function resolveBaseUrl(socket) {
  return socket.handshake.headers.origin || ALLOWED_ORIGINS[0];
}

// roomId -> Timeout. A brief network drop for the owner shouldn't destroy
// the room instantly; this gives them a window to reconnect and reclaim it.
const graceTimers = new Map();

function clearGraceTimer(roomId) {
  const timer = graceTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(roomId);
  }
}

function scheduleGraceClose(roomId, io) {
  clearGraceTimer(roomId);
  const timer = setTimeout(() => {
    graceTimers.delete(roomId);
    const room = getRoom(roomId);
    if (room && !room.ownerConnected) {
      deleteRoom(roomId);
      io.to(roomId).emit("room-closed", { reason: "sender-disconnected" });
      console.log("Closed room after owner grace period expired:", roomId);
    }
  }, OWNER_GRACE_MS);
  graceTimers.set(roomId, timer);
}

const app = express();

app.use(cors({ origin: ALLOWED_ORIGINS }));

// ─── TURN CREDENTIALS ───
//
// STUN alone can't traverse every NAT (symmetric NAT, carrier-grade NAT on
// mobile networks, some corporate firewalls) — those connections need a TURN
// relay as a fallback. This proxies short-lived credentials from Metered's
// free tier (metered.ca) so the API key never ships in the frontend bundle.
// If it's not configured, this responds with an empty list and the frontend
// falls back to STUN-only (same behavior as before TURN support existed).
const METERED_APP_NAME = process.env.METERED_APP_NAME;
const METERED_API_KEY = process.env.METERED_API_KEY;

let turnCredentialsCache = null;
let turnCredentialsCacheAt = 0;
const TURN_CACHE_TTL_MS = 5 * 60 * 1000;

app.get("/api/ice-servers", async (req, res) => {
  if (!METERED_APP_NAME || !METERED_API_KEY) {
    return res.json([]);
  }

  const now = Date.now();
  if (turnCredentialsCache && now - turnCredentialsCacheAt < TURN_CACHE_TTL_MS) {
    return res.json(turnCredentialsCache);
  }

  try {
    const response = await fetch(
      `https://${METERED_APP_NAME}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
    );
    if (!response.ok) throw new Error(`Metered API responded ${response.status}`);

    const iceServers = await response.json();
    turnCredentialsCache = iceServers;
    turnCredentialsCacheAt = now;
    res.json(iceServers);
  } catch (err) {
    console.error("Failed to fetch TURN credentials:", err.message);
    res.json([]); // fail open to STUN-only rather than breaking transfers entirely
  }
});

// Serve the built frontend (frontend/dist) so the whole app is one
// deployable service — this is what makes a single Render/Railway/etc.
// web service work: it builds the frontend, then this process serves both
// the static site and the Socket.IO signaling on the same port.
//
// In local split-dev (`npm run dev` in frontend on :5173, backend on :3000
// separately) frontend/dist won't exist yet, so this is skipped entirely
// and the API-only backend behaves exactly as before.
const FRONTEND_DIST = path.join(__dirname, "..", "..", "frontend", "dist");

if (fs.existsSync(path.join(FRONTEND_DIST, "index.html"))) {
  app.use(express.static(FRONTEND_DIST));

  // SPA fallback: any non-file route (e.g. /room/ABC123) should still load
  // index.html so React Router can take over client-side. Socket.IO claims
  // /socket.io/* itself before Express ever sees those requests, and the
  // /api/ route above is already registered first — the exclusions below
  // are kept as a belt-and-suspenders guard regardless.
  app.get(/^(?!\/(socket\.io|api)\/).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });

  console.log("Serving frontend build from", FRONTEND_DIST);
} else {
  console.log("No frontend build found at", FRONTEND_DIST, "— running as API-only (local split-dev mode)");
}

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS },
  // Lower than the socket.io default (60s/25s) so a genuinely dropped peer
  // (phone backgrounded, WiFi off) is noticed in ~20s instead of ~85s —
  // that's how fast "receiver-left" / "owner-disconnected" reach everyone
  // else in the room.
  pingTimeout: 15000,
  pingInterval: 10000,
  maxHttpBufferSize: 1e8
});


function validate(schema, payload, onError) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    onError();
    return null;
  }
  return result.data;
}


io.on("connection", (socket) => {

  console.log("connected:", socket.id);

  const ip = socket.handshake.address;


  // ─── CREATE ROOM ───

  socket.on("create-room", (payload) => {

    if (!checkLimit(ip, "create-room", { max: 10, windowMs: 5 * 60 * 1000 })) {
      socket.emit("room-error", "Too many rooms created — try again later");
      return;
    }

    const data = validate(createRoomSchema, payload, () =>
      socket.emit("room-error", "Invalid request")
    );
    if (!data) return;

    const room = createRoom(socket.id, data.name);

    socket.join(room.roomId);

    const roomLink = `${resolveBaseUrl(socket)}/room/${room.roomId}`;

    console.log("Room created:", room.roomId);

    socket.emit("room-created", {
      roomId: room.roomId,
      roomLink,
      otp: room.otp,
      ownerToken: room.ownerToken,
      uploadPolicy: room.uploadPolicy
    });

  });


  // ─── UPLOAD POLICY (owner-initiated) ───

  socket.on("set-upload-policy", (payload) => {

    const data = validate(setUploadPolicySchema, payload, () => {});
    if (!data) return;

    const result = setUploadPolicy(data.roomId, socket.id, data.policy);
    if (!result.ok) return;

    touchRoom(data.roomId);
    io.to(data.roomId).emit("upload-policy-changed", { policy: data.policy });

  });


  // ─── RECLAIM ROOM (owner reconnecting after a network drop) ───

  socket.on("reclaim-room", (payload) => {

    const data = validate(reclaimRoomSchema, payload, () =>
      socket.emit("reclaim-failed", "Invalid request")
    );
    if (!data) return;

    const { roomId, ownerToken } = data;

    const result = reclaimOwnership(roomId, ownerToken, socket.id);

    if (!result.ok) {
      socket.emit("reclaim-failed", "This room no longer exists");
      return;
    }

    clearGraceTimer(roomId);
    socket.join(roomId);

    console.log("Room reclaimed by original owner:", roomId);

    socket.emit("room-reclaimed", {
      roomId,
      metadata: result.room.metadata,
      receivers: result.room.receivers,
      uploadPolicy: result.room.uploadPolicy
    });

    socket.to(roomId).emit("owner-reconnected", { ownerSocketId: socket.id });

  });


  // ─── CLOSE ROOM (owner-initiated) ───

  socket.on("close-room", (payload) => {

    const data = validate(roomOnlySchema, payload, () => {});
    if (!data) return;

    const room = getRoom(data.roomId);
    if (!room || room.owner.socketId !== socket.id) return;

    clearGraceTimer(data.roomId);
    deleteRoom(data.roomId);

    io.to(data.roomId).emit("room-closed", { reason: "owner-closed" });
    console.log("Room closed by owner:", data.roomId);

  });


  // ─── LEAVE ROOM (receiver-initiated) ───

  socket.on("leave-room", (payload) => {

    const data = validate(roomOnlySchema, payload, () => {});
    if (!data) return;

    const room = getRoom(data.roomId);
    if (!room) return;

    removeReceiver(data.roomId, socket.id);
    socket.leave(data.roomId);

    io.to(data.roomId).emit("receiver-left", {
      socketId: socket.id
    });

    const removedFileIds = removeFilesBySender(data.roomId, socket.id);
    if (removedFileIds.length > 0) {
      io.to(data.roomId).emit("files-removed", { fileIds: removedFileIds });
    }

  });


  // ─── JOIN ROOM ───

  socket.on("join-room", (payload) => {

    if (!checkLimit(ip, "join-room", { max: 20, windowMs: 5 * 60 * 1000 })) {
      socket.emit("room-error", "Too many attempts — try again later");
      return;
    }

    const data = validate(joinRoomSchema, payload, () =>
      socket.emit("room-error", "Invalid request")
    );
    if (!data) return;

    const { roomId, name, otp } = data;

    const room = getRoom(roomId);

    if (!room) {
      socket.emit("room-error", "Room does not exist");
      return;
    }

    const otpResult = verifyOtp(roomId, socket.id, otp);

    if (!otpResult.ok) {
      if (otpResult.reason === "locked") {
        socket.emit("room-error", "Too many incorrect attempts — try again in a minute");
      } else {
        socket.emit("room-error", "Incorrect code");
      }
      return;
    }

    joinRoom(roomId, socket.id, name);
    touchRoom(roomId);

    socket.join(roomId);

    // receiver gets sender name + metadata + current room settings/roster
    socket.emit("joined-room", {
      ownerName: room.owner.name,
      ownerSocketId: room.owner.socketId,
      metadata: room.metadata,
      uploadPolicy: room.uploadPolicy,
      receivers: room.receivers
    });

    // notify everyone else in the room about the new receiver (any of them
    // may need to know who's present if the upload policy lets them send too)
    socket.to(roomId).emit("receiver-joined", {
      socketId: socket.id,
      name
    });

  });


  // ─── FILE METADATA FROM AN UPLOADER ───

  socket.on("file-metadata", (payload) => {

    const data = validate(fileMetadataSchema, payload, () =>
      socket.emit("room-error", "Invalid request")
    );
    if (!data) return;

    const { roomId, files } = data;

    const room = getRoom(roomId);
    if (!room) return;

    if (!canUpload(room, socket.id)) {
      socket.emit("room-error", "Only the room owner can send files right now");
      return;
    }

    const uploaderName = findParticipantName(room, socket.id);
    const newFiles = addMetadata(roomId, files, socket.id, uploaderName);

    if (!newFiles) return;

    touchRoom(roomId);

    // send metadata to everyone else in the room
    socket.to(roomId).emit("new-files", newFiles);

    // acknowledge back to the uploader with generated fileIds
    socket.emit("metadata-ack", newFiles);

  });


  // ─── WebRTC SIGNALING ───

  // Someone requests a specific file from whoever uploaded it
  socket.on("request-file", (payload) => {

    const data = validate(requestFileSchema, payload, () =>
      socket.emit("room-error", "Invalid request")
    );
    if (!data) return;

    const { roomId, fileId } = data;

    const room = getRoom(roomId);
    if (!room) return;

    const fileMeta = findFileMeta(roomId, fileId);
    if (!fileMeta || !isParticipant(room, fileMeta.senderSocketId)) {
      socket.emit("room-error", "This file's sender is no longer in the room");
      return;
    }

    touchRoom(roomId);

    // Forward the request to whoever is hosting the file
    io.to(fileMeta.senderSocketId).emit("file-requested", {
      fileId,
      receiverSocketId: socket.id
    });

  });

  // Cancels an in-progress transfer, routed to the file's actual uploader
  socket.on("cancel-transfer", (payload) => {
    const data = validate(requestFileSchema, payload, () => {});
    if (!data) return;

    const { roomId, fileId } = data;
    const room = getRoom(roomId);
    if (!room) return;

    const fileMeta = findFileMeta(roomId, fileId);
    if (!fileMeta) return;

    touchRoom(roomId);

    io.to(fileMeta.senderSocketId).emit("cancel-transfer", {
      fileId,
      receiverSocketId: socket.id
    });
  });

  // Owner sends an offer to a specific receiver
  socket.on("webrtc-offer", (payload) => {
    const data = validate(webrtcOfferSchema, payload, () => {});
    if (!data) return;

    const { targetSocketId, offer, fileId } = data;
    io.to(targetSocketId).emit("webrtc-offer", {
      offer,
      fileId,
      senderSocketId: socket.id
    });
  });

  // Receiver sends answer back to owner
  socket.on("webrtc-answer", (payload) => {
    const data = validate(webrtcAnswerSchema, payload, () => {});
    if (!data) return;

    const { targetSocketId, answer, fileId } = data;
    io.to(targetSocketId).emit("webrtc-answer", {
      answer,
      fileId,
      receiverSocketId: socket.id
    });
  });

  // ICE candidate exchange
  socket.on("ice-candidate", (payload) => {
    const data = validate(iceCandidateSchema, payload, () => {});
    if (!data) return;

    const { targetSocketId, candidate, fileId } = data;
    io.to(targetSocketId).emit("ice-candidate", {
      candidate,
      fileId,
      senderSocketId: socket.id
    });
  });


  // ─── DISCONNECT ───

  socket.on("disconnect", () => {

    console.log("disconnected:", socket.id);

    // Notify room members before cleanup
    const info = findRoomBySocket(socket.id);

    if (info) {
      if (info.role === "owner") {
        // Don't close the room instantly — a dropped WiFi connection is
        // common and the owner's client will try to reclaim the room under
        // its new socketId within OWNER_GRACE_MS. Only actually close it
        // if that window expires with no reclaim.
        io.to(info.roomId).emit("owner-disconnected");
        scheduleGraceClose(info.roomId, io);
      } else {
        // Notify the rest of the room that a receiver left
        const room = getRoom(info.roomId);
        if (room) {
          io.to(info.roomId).emit("receiver-left", {
            socketId: socket.id
          });

          // Unlike the owner, a regular receiver gets no reconnect grace —
          // their uploads are gone the moment they are, so stop listing them.
          const removedFileIds = removeFilesBySender(info.roomId, socket.id);
          if (removedFileIds.length > 0) {
            io.to(info.roomId).emit("files-removed", { fileIds: removedFileIds });
          }
        }
      }
    }

    removeSocket(socket.id);

  });

});


// ─── IDLE ROOM SWEEP ───

setInterval(() => {
  const closedRoomIds = sweepIdleRooms(IDLE_TIMEOUT_MS);
  closedRoomIds.forEach(roomId => {
    clearGraceTimer(roomId);
    io.to(roomId).emit("room-closed", { reason: "idle-timeout" });
    console.log("Closed idle room:", roomId);
  });
}, SWEEP_INTERVAL_MS);


server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
