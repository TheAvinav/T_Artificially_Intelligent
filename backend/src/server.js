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
  pingInterval: 25000
});


io.on("connection", (socket) => {

  console.log("connected:", socket.id);


  // CREATE ROOM

  socket.on("create-room", ({ name }) => {

    const room = createRoom(socket.id, name);

    socket.join(room.roomId);

    const roomLink = `http://localhost:5173/room/${room.roomId}`;
    console.log("Room created");

    socket.emit("room-created", {
      roomId: room.roomId,
      roomLink
    });

  });



  // JOIN ROOM

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

    // notify owner
    io.to(room.owner.socketId).emit("receiver-joined", {
      socketId: socket.id,
      name
    });

  });



  // FILE METADATA FROM OWNER

  socket.on("file-metadata", ({ roomId, files }) => {

    const newFiles = addMetadata(roomId, files);

    if (!newFiles) return;

    // send metadata to receivers
    socket.to(roomId).emit("new-files", newFiles);

    // send metadata + fileId back to sender
    socket.emit("metadata-ack", newFiles);

  });



  socket.on("disconnect", () => {

    console.log("disconnected:", socket.id);

    removeSocket(socket.id);

  });

});


server.listen(3000, () => {
  console.log("Server running on port 3000");
});