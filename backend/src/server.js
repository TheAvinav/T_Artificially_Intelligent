const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const { createRoom, joinRoom, getRoom } = require("./rooms");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // CREATE ROOM
  socket.on("create-room", () => {
    const roomId = createRoom();

    socket.join(roomId);

    joinRoom(roomId, socket.id);

    const roomLink = `http://localhost:5173/room/${roomId}`;

    socket.emit("room-created", {
      roomId,
      roomLink,
    });

    console.log("Room created:", roomId);
  });

  // JOIN ROOM
  socket.on("join-room", ({ roomId }) => {
    const room = getRoom(roomId);

    if (!room) {
      socket.emit("error", "Room does not exist");
      return;
    }

    socket.join(roomId);

    joinRoom(roomId, socket.id);

    socket.emit("joined-room", {
      roomId,
      users: room.users,
    });

    socket.to(roomId).emit("user-joined", {
      socketId: socket.id,
    });

    console.log(socket.id, "joined", roomId);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});