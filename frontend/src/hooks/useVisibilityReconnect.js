import { useEffect } from 'react';
import socket from '../lib/socket';

// Mobile browsers frequently freeze a backgrounded tab's timers entirely
// (and often drop the underlying WebSocket outright). socket.io's own
// reconnect backoff is a setTimeout, which can simply never fire while the
// tab is frozen — so on resume the socket can be stuck "trying to reconnect"
// indefinitely. Nudging it explicitly the moment the tab becomes visible
// again fixes that instead of waiting on a timer that may never run.
export function useVisibilityReconnect() {
  useEffect(() => {
    const tryReconnect = () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        socket.connect();
      }
    };

    document.addEventListener('visibilitychange', tryReconnect);
    window.addEventListener('focus', tryReconnect);

    return () => {
      document.removeEventListener('visibilitychange', tryReconnect);
      window.removeEventListener('focus', tryReconnect);
    };
  }, []);
}
