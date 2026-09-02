---

# Secure P2P File Transfer

A simple peer-to-peer file sharing app built with **React, Node.js, Socket.IO, and WebRTC**.

The server only handles **rooms and signaling**.
Files are sent **directly between users**, not through the server.

---

## How it works

1. A user creates a **room**.
2. Others join using the **room ID or link**.
3. The sender selects files.
4. Peers connect using **WebRTC**.
5. Files are transferred **browser to browser**.

The server is only used to coordinate the connection.

---

## Tech Stack

Frontend

* React
* Vite
* Socket.IO client

Backend

* Node.js
* Express
* Socket.IO

Networking

* WebRTC (DataChannels)

---

## Project Structure

```
backend
 └─ src
    ├─ server.js
    └─ room.js

frontend
 └─ src
    ├─ hooks
    │   └─ useWebRTC.js
    ├─ lib
    │   ├─ socket.js
    │   └─ utils.js
    ├─ pages
    │   ├─ Home.jsx
    │   ├─ SenderRoom.jsx
    │   └─ ReceiverRoom.jsx
```

---

## Run locally

Clone the repo

```
git clone <repo-url>
```

### Backend

```
cd backend
npm install
node src/server.js
```

### Frontend

```
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. `frontend/.env`'s `VITE_SERVER_URL` points it at the backend.

**Single service (matches production)** — build the frontend once, then have the backend serve it:

```bash
npm run build   # from the repo root
npm start       # from the repo root — serves the built frontend + Socket.IO on one port
```

Open `http://localhost:3000` — everything (UI + signaling) comes from that one origin.

## Build Instructions

```bash
npm run build   # from the repo root — builds frontend/dist
```

## Deployment

This app deploys as a **single service**: the Express backend serves the built React frontend as static files and handles Socket.IO signaling on the same port, so there's only one URL and no cross-origin configuration to get right. The shareable room link is derived from whatever URL the browser actually loaded the app from, so no URL needs to be configured ahead of time.

**Render** (recommended — supports the always-on Node process this app needs):

1. Push this repo to GitHub.
2. In Render, "New +" → "Blueprint", point it at the repo — `render.yaml` at the root configures the service (build command `npm run build`, start command `npm start`) automatically. Or create a Web Service manually with those same two commands.
3. Deploy. No env vars are strictly required for a single-service deployment, but see **TURN server (recommended)** below — without it, transfers only work reliably between devices on the same network.

Railway or Fly.io work the same way (same build/start commands); a plain VPS works too (`npm run build && npm start`, kept alive with something like `pm2` or a systemd unit).

**Why not Vercel:** Vercel's serverless functions are stateless and short-lived — they don't hold the persistent process this app needs. The backend keeps rooms in an in-memory `Map` and relies on long-lived Socket.IO connections (WebSocket, with HTTP long-polling fallback); both break under Vercel's serverless model (state resets between invocations, and the WebSocket/polling handshake isn't reliably supported). Vercel is a fine place to host *just* the static frontend build if you want to split the deployment — set `FRONTEND_URL` on the backend to that Vercel URL and `VITE_SERVER_URL` on the frontend to the backend's URL — but the backend itself needs a host with a real persistent process.

### TURN server (recommended)

STUN alone (the default) only lets two peers connect directly when their networks are cooperative — it fails between many real-world network pairs (mobile data/CGNAT, symmetric NAT, some corporate firewalls), even though it works fine when both devices share one network (e.g. a phone on a laptop's hotspot). Fixing this needs a TURN relay as fallback:

1. Sign up free at [metered.ca/tools/openrelay](https://www.metered.ca/tools/openrelay/) — 20GB/month free, no credit card.
2. From their dashboard, get your app name (subdomain) and API key.
3. Set two env vars on your host (Render: service → Environment):
   - `METERED_APP_NAME`
   - `METERED_API_KEY`

The backend proxies credentials from these through `GET /api/ice-servers` so the API key never ships to the browser. Leave them unset and the app just falls back to STUN-only, same as before.

## Usage Walkthrough

### Create a room
1. Open the app, click **Create Room**, enter a display name.
2. You land on the room screen with a 6-character **room code**, a 6-digit **PIN**, a QR code, and a **Share Room** button (native share sheet or clipboard copy — includes both the link and the PIN).
3. Optionally switch **Who can send files** to "Anyone in the room" if you want participants to be able to add files too.

### Join a room
1. Open the app, click **Join Room**.
2. Enter a display name, the room code (or paste the full link), and the PIN.
3. You're in — you'll see whatever files have already been added, live, as more get added.

### Send / receive files
1. Whoever is allowed to upload (the owner, or anyone if the policy allows) drags files/folders into the drop zone.
2. Every participant sees the new files immediately, tagged with who sent them.
3. Clicking **Receive** on a file starts a direct WebRTC transfer straight from the uploader's browser — live progress, speed, and ETA update as it downloads. Uploads can be paused, resumed, or cancelled from the sender's side; downloads can be cancelled or retried from the receiver's side.

### Leaving
- A participant can click **Leave** at any time — the owner and everyone else is notified immediately, and that participant's own uploaded files are removed from the room.
- The owner can click **Close Room** (with a confirmation) to end the session for everyone, who are all redirected home with a notice.

## Socket.IO API (the app's protocol — no REST endpoints)

### Client → Server
| Event | Payload |
|---|---|
| `create-room` | `{ name }` |
| `join-room` | `{ roomId, name, otp }` |
| `reclaim-room` | `{ roomId, ownerToken }` — owner reconnecting after a drop |
| `set-upload-policy` | `{ roomId, policy }` — `policy` is `"owner-only"` or `"anyone"`; owner-only action |
| `close-room` | `{ roomId }` — owner-only |
| `leave-room` | `{ roomId }` |
| `file-metadata` | `{ roomId, files: [{ name, size, type }] }` |
| `request-file` | `{ roomId, fileId }` |
| `cancel-transfer` | `{ roomId, fileId }` |
| `webrtc-offer` / `webrtc-answer` / `ice-candidate` | `{ targetSocketId, fileId, offer/answer/candidate }` |

### Server → Client
| Event | Payload |
|---|---|
| `room-created` | `{ roomId, roomLink, otp, ownerToken, uploadPolicy }` |
| `joined-room` | `{ ownerName, ownerSocketId, metadata, uploadPolicy, receivers }` |
| `room-reclaimed` | `{ roomId, metadata, receivers, uploadPolicy }` |
| `reclaim-failed` | error message string |
| `room-error` | error message string |
| `upload-policy-changed` | `{ policy }` |
| `receiver-joined` / `receiver-left` | `{ socketId, name? }` |
| `owner-disconnected` / `owner-reconnected` | *(none)* / `{ ownerSocketId }` |
| `room-closed` | `{ reason }` — `"owner-closed"`, `"sender-disconnected"`, or `"idle-timeout"` |
| `new-files` | `[{ fileId, name, size, type, uploadedAt, senderSocketId, senderName }]` |
| `files-removed` | `{ fileIds }` — that uploader left/disconnected |
| `metadata-ack` | ack of your own `file-metadata` call, same shape as `new-files` |
| `file-requested` | `{ fileId, receiverSocketId }` — sent to whoever is hosting the file |
| `cancel-transfer` | `{ fileId, receiverSocketId }` |
| `webrtc-offer` / `webrtc-answer` / `ice-candidate` | `{ fileId, offer/answer/candidate, senderSocketId/receiverSocketId }` |

## Data Model (in-memory only — no database)

**Room**
```js
{
  roomId,          // 6-char code, also the Socket.IO room name
  otp,             // 6-digit PIN required to join
  owner: { socketId, name },
  ownerToken,      // secret used to reclaim the room after a reconnect
  ownerConnected,  // false during the reconnect grace window
  receivers: [{ socketId, name }],
  uploadPolicy,    // "owner-only" | "anyone"
  metadata: [ FileMetadata ],
  createdAt, lastActivity
}
```

**FileMetadata**
```js
{ fileId, name, size, type, uploadedAt, senderSocketId, senderName }
```

A room's entire state lives in a single process-local `Map` — restarting the backend drops every room.

## Known Limitations

- **No persistence** — all state is in-memory; a server restart or the idle-timeout sweep wipes rooms.
- **No account system** — a room is only as private as its code + PIN combination.
- **TURN server is optional and off by default** — without `METERED_APP_NAME`/`METERED_API_KEY` set (see Deployment → TURN server), only STUN is used for ICE, so a direct connection can fail behind symmetric NATs, mobile carrier CGNAT, or restrictive corporate firewalls with no fallback relay.
- **A regular participant's uploads don't survive their own disconnect** — unlike the owner (who gets a 45s reconnect grace period via a secret token), a non-owner who drops loses their uploaded files immediately; this is a deliberate scope cut, not a bug, since there's no way to verify a reconnecting participant's identity without a similar token mechanism.
- **No file-integrity verification** — WebRTC's DataChannel is reliable and ordered by default, but there's no application-level checksum comparing the sent and received file.

## Contributors

* Abhinay Ragam
* Hrushikesh Musaloj
* Jayasai Badigeru
* TL: Avinav Mendu

## License

Unlicense

---
