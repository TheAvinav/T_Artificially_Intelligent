const { z } = require("zod");

const roomIdField = z.string().length(6);
const nameField = z.string().trim().min(1).max(40);
const otpField = z.string().length(6);
const socketIdField = z.string().min(1).max(100);
const fileIdField = z.string().uuid();

const createRoomSchema = z.object({
  name: nameField
});

const joinRoomSchema = z.object({
  roomId: roomIdField,
  name: nameField,
  otp: otpField
});

const fileMetadataSchema = z.object({
  roomId: roomIdField,
  files: z.array(z.object({
    name: z.string().min(1).max(255),
    size: z.number().nonnegative(),
    type: z.string().max(255)
  })).min(1).max(200)
});

const requestFileSchema = z.object({
  roomId: roomIdField,
  fileId: fileIdField
});

const webrtcOfferSchema = z.object({
  targetSocketId: socketIdField,
  fileId: fileIdField,
  offer: z.any()
});

const webrtcAnswerSchema = z.object({
  targetSocketId: socketIdField,
  fileId: fileIdField,
  answer: z.any()
});

const iceCandidateSchema = z.object({
  targetSocketId: socketIdField,
  fileId: fileIdField,
  candidate: z.any()
});

const reclaimRoomSchema = z.object({
  roomId: roomIdField,
  ownerToken: z.string().uuid()
});

const roomOnlySchema = z.object({
  roomId: roomIdField
});

const setUploadPolicySchema = z.object({
  roomId: roomIdField,
  policy: z.enum(["owner-only", "anyone"])
});

module.exports = {
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
};
