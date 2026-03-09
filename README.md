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

Open the app at

```
http://localhost:5173
```

---

## What the server actually does

* create rooms
* track users in a room
* broadcast file metadata
* handle socket connections

The server **never stores or sends files**.

---

## Things we want to improve

* resumable transfers
* better NAT traversal
* encryption options
* persistent rooms

---

## Contributors

* Abhinay Ragam
* Hrushikesh Musaloj
* Jayasai Badigeru
* TL: Avinav Mendu

---

## License

Unlicense

---
