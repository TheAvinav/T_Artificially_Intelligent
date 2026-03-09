const { v4: uuidv4 } = require("uuid");

const rooms = new Map();

/*
Room structure

{
  roomId,
  owner: { socketId, name },
  receivers: [ {socketId, name} ],
  metadata: []
}
*/

function createRoom(ownerSocketId, ownerName) {

  const roomId = uuidv4();

  const room = {
    roomId,

    owner: {
      socketId: ownerSocketId,
      name: ownerName
    },

    receivers: [],

    metadata: []
  };

  rooms.set(roomId, room);

  return room;
}


function joinRoom(roomId, socketId, name) {

  const room = rooms.get(roomId);

  if (!room) return null;

  room.receivers.push({
    socketId,
    name
  });

  return room;
}


function addMetadata(roomId, files) {

  const room = rooms.get(roomId);

  if (!room) return null;

  const newFiles = files.map(file => {

    return {
      fileId: uuidv4(),
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: Date.now()
    };

  });

  room.metadata.push(...newFiles);

  return newFiles;
}


function getRoom(roomId) {
  return rooms.get(roomId);
}


function removeSocket(socketId) {

  for (const room of rooms.values()) {

    if (room.owner.socketId === socketId) {
      rooms.delete(room.roomId);
      return;
    }

    room.receivers = room.receivers.filter(
      r => r.socketId !== socketId
    );
  }
}


module.exports = {
  createRoom,
  joinRoom,
  addMetadata,
  getRoom,
  removeSocket
};