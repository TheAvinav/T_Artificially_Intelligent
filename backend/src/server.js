const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const {
  createRoom,
  joinRoom,
  addMetadata,
  getRoom,
  removeSocket
} = require("./room");

const app = express();

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8
});


io.on("connection", (socket) => {

  console.log("connected:", socket.id);


  // ─── CREATE ROOM ───

  socket.on("create-room", ({ name }) => {

    const room = createRoom(socket.id, name);

    socket.join(room.roomId);

    // Use env or default for the frontend URL
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const roomLink = `${frontendUrl}/room/${room.roomId}`;

    console.log("Room created:", room.roomId);

    socket.emit("room-created", {
      roomId: room.roomId,
      roomLink
    });

  });


  // ─── JOIN ROOM ───

  socket.on("join-room", ({ roomId, name }) => {

    const room = getRoom(roomId);

    if (!room) {
      socket.emit("room-error", "Room does not exist");
      return;
    }

    joinRoom(roomId, socket.id, name);

    socket.join(roomId);

    // receiver gets sender name + metadata
    socket.emit("joined-room", {
      ownerName: room.owner.name,
      metadata: room.metadata
    });

    // notify owner about the new receiver
    io.to(room.owner.socketId).emit("receiver-joined", {
      socketId: socket.id,
      name
    });

  });


  // ─── FILE METADATA FROM OWNER ───

  socket.on("file-metadata", ({ roomId, files }) => {

    const newFiles = addMetadata(roomId, files);

    if (!newFiles) return;

    // send metadata to all receivers in the room
    socket.to(roomId).emit("new-files", newFiles);

    // acknowledge back to sender with generated fileIds
    socket.emit("metadata-ack", newFiles);

  });


  // ─── WebRTC SIGNALING ───

  // Receiver requests a specific file from the owner
  socket.on("request-file", ({ roomId, fileId }) => {

    const room = getRoom(roomId);
    if (!room) return;

    // Forward the request to the owner
    io.to(room.owner.socketId).emit("file-requested", {
      fileId,
      receiverSocketId: socket.id
    });

  });

  // Owner sends an offer to a specific receiver
  socket.on("webrtc-offer", ({ targetSocketId, offer, fileId }) => {
    io.to(targetSocketId).emit("webrtc-offer", {
      offer,
      fileId,
      senderSocketId: socket.id
    });
  });

  // Receiver sends answer back to owner
  socket.on("webrtc-answer", ({ targetSocketId, answer, fileId }) => {
    io.to(targetSocketId).emit("webrtc-answer", {
      answer,
      fileId,
      receiverSocketId: socket.id
    });
  });

  // ICE candidate exchange
  socket.on("ice-candidate", ({ targetSocketId, candidate, fileId }) => {
    io.to(targetSocketId).emit("ice-candidate", {
      candidate,
      fileId,
      senderSocketId: socket.id
    });
  });


  // ─── TRANSFER PROGRESS ───

  // Either side can report progress; relay to the room owner
  socket.on("transfer-progress", ({ roomId, fileId, receiverSocketId, progress }) => {
    const room = getRoom(roomId);
    if (!room) return;

    // Send progress update to owner
    io.to(room.owner.socketId).emit("transfer-progress", {
      fileId,
      receiverSocketId,
      progress // 0-100
    });
  });

  socket.on("transfer-complete", ({ roomId, fileId, receiverSocketId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    io.to(room.owner.socketId).emit("transfer-complete", {
      fileId,
      receiverSocketId
    });
  });


  // ─── DISCONNECT ───

  socket.on("disconnect", () => {

    console.log("disconnected:", socket.id);

    // Notify room members before cleanup
    const { v4: uuidv4 } = require("uuid");
    // Find rooms this socket belongs to
    const { findRoomBySocket } = require("./room");

    const info = findRoomBySocket(socket.id);

    if (info) {
      if (info.role === "owner") {
        // Notify all receivers that the room is closing
        io.to(info.roomId).emit("room-closed");
      } else {
        // Notify owner that a receiver left
        const room = getRoom(info.roomId);
        if (room) {
          io.to(room.owner.socketId).emit("receiver-left", {
            socketId: socket.id
          });
        }
      }
    }

    removeSocket(socket.id);

  });

});


server.listen(3000, () => {
  console.log("Server running on port 3000");
});