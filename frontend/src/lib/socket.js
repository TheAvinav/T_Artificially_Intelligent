import { io } from "socket.io-client";

// Only needed for local split-dev (Vite dev server on :5173 talking to a
// separately-running backend on :3000). In production the backend serves
// this app itself, so leaving this unset lets socket.io connect to
// whatever origin the page was actually loaded from.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || undefined;

const socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ["websocket", "polling"],
});

export default socket;