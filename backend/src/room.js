const { v4: uuidv4 } = require("uuid");

const rooms = new Map();

function createRoom() {
  const roomId = uuidv4();
  rooms.set(roomId, {
    users: [],
  });
  return roomId;
}

function joinRoom(roomId, socketId) {
  const room = rooms.get(roomId);

  if (!room) return null;

  room.users.push(socketId);

  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

module.exports = {
  createRoom,
  joinRoom,
  getRoom,
};