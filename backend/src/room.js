const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

const rooms = new Map();

// Unambiguous alphabet: no 0/O or 1/I/L
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const OTP_MIN = 100000;
const OTP_MAX = 1000000;

/*
Room structure

{
  roomId,       // short human-friendly code, also the Socket.IO room name
  otp,          // 6-digit numeric PIN required to join
  otpAttempts,  // Map<socketId, { count, lockedUntil }>
  owner: { socketId, name },
  ownerToken,   // secret held only by the owner's browser, used to reclaim
                // the room under a new socketId after a network drop
  ownerConnected, // false while the owner's socket is disconnected but the
                   // room is still within its reconnect grace period
  receivers: [ {socketId, name} ],
  uploadPolicy, // "owner-only" | "anyone" — who is allowed to add files
  metadata: [], // { fileId, name, size, type, uploadedAt, senderSocketId, senderName }
  createdAt,
  lastActivity
}
*/

function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: CODE_LENGTH }, () =>
      CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function generateOtp() {
  return crypto.randomInt(OTP_MIN, OTP_MAX).toString();
}

function createRoom(ownerSocketId, ownerName) {

  const roomId = generateRoomCode();
  const now = Date.now();

  const room = {
    roomId,
    otp: generateOtp(),
    otpAttempts: new Map(),

    owner: {
      socketId: ownerSocketId,
      name: ownerName
    },
    ownerToken: crypto.randomUUID(),
    ownerConnected: true,

    receivers: [],
    uploadPolicy: "owner-only",

    metadata: [],

    createdAt: now,
    lastActivity: now
  };

  rooms.set(roomId, room);

  return room;
}


function joinRoom(roomId, socketId, name) {

  const room = rooms.get(roomId);

  if (!room) return null;

  // Prevent duplicate joins
  const existing = room.receivers.find(r => r.socketId === socketId);
  if (existing) return room;

  room.receivers.push({
    socketId,
    name
  });

  return room;
}


function isParticipant(room, socketId) {
  return room.owner.socketId === socketId || room.receivers.some(r => r.socketId === socketId);
}


function canUpload(room, socketId) {
  return room.uploadPolicy === "anyone"
    ? isParticipant(room, socketId)
    : room.owner.socketId === socketId;
}


function setUploadPolicy(roomId, socketId, policy) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: "not-found" };
  if (room.owner.socketId !== socketId) return { ok: false, reason: "forbidden" };

  room.uploadPolicy = policy;
  return { ok: true, room };
}


// Looks up who's currently connected under a given socketId within a room —
// used to label uploads with a display name without trusting the client.
function findParticipantName(room, socketId) {
  if (room.owner.socketId === socketId) return room.owner.name;
  const receiver = room.receivers.find(r => r.socketId === socketId);
  return receiver ? receiver.name : null;
}


function addMetadata(roomId, files, uploaderSocketId, uploaderName) {

  const room = rooms.get(roomId);

  if (!room) return null;

  const newFiles = files.map(file => {

    return {
      fileId: uuidv4(),
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: Date.now(),
      senderSocketId: uploaderSocketId,
      senderName: uploaderName
    };

  });

  room.metadata.push(...newFiles);

  return newFiles;
}


function findFileMeta(roomId, fileId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.metadata.find(f => f.fileId === fileId) || null;
}


function getRoom(roomId) {
  return rooms.get(roomId);
}


function touchRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) room.lastActivity = Date.now();
}


// Returns true if the OTP was correct. Tracks failed attempts per socket
// and locks a socket out of retrying for LOCKOUT_MS after MAX_ATTEMPTS
// consecutive failures against a given room.
const MAX_OTP_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 60 * 1000;

function verifyOtp(roomId, socketId, otp) {

  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: "not-found" };

  const attempt = room.otpAttempts.get(socketId) || { count: 0, lockedUntil: 0 };

  if (attempt.lockedUntil > Date.now()) {
    return { ok: false, reason: "locked" };
  }

  if (room.otp === otp) {
    room.otpAttempts.delete(socketId);
    return { ok: true };
  }

  attempt.count += 1;
  if (attempt.count >= MAX_OTP_ATTEMPTS) {
    attempt.lockedUntil = Date.now() + OTP_LOCKOUT_MS;
    attempt.count = 0;
  }
  room.otpAttempts.set(socketId, attempt);

  return { ok: false, reason: "incorrect" };
}


function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.owner.socketId === socketId) {
      return { roomId: room.roomId, role: "owner" };
    }
    const receiver = room.receivers.find(r => r.socketId === socketId);
    if (receiver) {
      return { roomId: room.roomId, role: "receiver" };
    }
  }
  return null;
}


// Does NOT delete the room when the owner disconnects — a network blip
// shouldn't destroy the room out from under everyone still in it. The caller
// is responsible for starting a reconnect grace period (see server.js) and
// calling deleteRoom() once that expires without a reclaimOwnership() call.
function removeSocket(socketId) {

  for (const room of rooms.values()) {

    if (room.owner.socketId === socketId) {
      room.ownerConnected = false;
      return;
    }

    room.receivers = room.receivers.filter(
      r => r.socketId !== socketId
    );
  }
}


function removeReceiver(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.receivers = room.receivers.filter(r => r.socketId !== socketId);
}


// A regular receiver who uploaded files and then left (or dropped) is gone
// for good — unlike the owner, receivers get no reconnect grace period — so
// their files can no longer be served to anyone. Strip them from the room's
// metadata and return the removed fileIds so the caller can tell everyone
// still in the room to stop listing them.
function removeFilesBySender(roomId, senderSocketId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const removed = room.metadata
    .filter(f => f.senderSocketId === senderSocketId)
    .map(f => f.fileId);

  if (removed.length > 0) {
    room.metadata = room.metadata.filter(f => f.senderSocketId !== senderSocketId);
  }

  return removed;
}


function deleteRoom(roomId) {
  rooms.delete(roomId);
}


// Lets the original owner's browser re-attach to its room under a new
// socketId (e.g. after the network drops and Socket.IO reconnects) by
// presenting the secret token it was given when the room was created.
function reclaimOwnership(roomId, ownerToken, newSocketId) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: "not-found" };
  if (room.ownerToken !== ownerToken) return { ok: false, reason: "invalid-token" };

  const oldSocketId = room.owner.socketId;
  room.owner.socketId = newSocketId;
  room.ownerConnected = true;
  room.lastActivity = Date.now();

  // Any files the owner had already uploaded point at their old (now dead)
  // socketId — repoint them so request-file routing keeps working.
  room.metadata.forEach(file => {
    if (file.senderSocketId === oldSocketId) {
      file.senderSocketId = newSocketId;
    }
  });

  return { ok: true, room };
}


// Closes and removes any room that has had no activity for longer than
// maxIdleMs. Returns the list of closed roomIds so the caller can notify members.
function sweepIdleRooms(maxIdleMs) {
  const now = Date.now();
  const closed = [];

  for (const room of rooms.values()) {
    if (now - room.lastActivity > maxIdleMs) {
      closed.push(room.roomId);
    }
  }

  closed.forEach(roomId => rooms.delete(roomId));

  return closed;
}


module.exports = {
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
};
