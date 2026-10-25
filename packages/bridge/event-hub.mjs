const listeners = new Map();

export function publishCompatibilityEvent(chatId, name, args = [], origin) {
  for (const listener of [...(listeners.get(chatId) ?? [])]) {
    if (listener.channel !== origin) listener.receive({ name, args }, origin);
  }
}

export function publishCompatibilityEvents(chatId, events = [], origin) {
  for (const event of events) publishCompatibilityEvent(chatId, event.name, event.args, origin);
}

export function subscribeCompatibilityEvents(chatId, channel, receive) {
  if (!listeners.has(chatId)) listeners.set(chatId, new Set());
  const listener = { channel, receive };
  listeners.get(chatId).add(listener);
  return () => {
    const subscribers = listeners.get(chatId);
    subscribers?.delete(listener);
    if (!subscribers?.size) listeners.delete(chatId);
  };
}
