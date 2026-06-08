const LOGOUT_KEY = "ayawin-auth-logout";
const CHANNEL_NAME = "ayawin-auth-channel";

export function broadcastLogout() {
  try {
    localStorage.setItem(LOGOUT_KEY, String(Date.now()));
    if (typeof BroadcastChannel !== "undefined") {
      new BroadcastChannel(CHANNEL_NAME).postMessage({ type: "logout" });
    }
  } catch {
    /* private mode / storage blocked */
  }
}

export function subscribeLogout(onLogout: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOGOUT_KEY) onLogout();
  };
  window.addEventListener("storage", onStorage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (event.data?.type === "logout") onLogout();
    };
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}
