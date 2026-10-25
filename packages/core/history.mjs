/** 状态只依赖此前历史；删楼、改开场或编辑正文会使后续链条失效。 */
export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function historyState(snapshot, replay, end = snapshot.chat.message.length) {
  const swipe = snapshot.chat.stCompatibility?.greetingSwipe ?? Math.max(0, (snapshot.chat.fmIndex ?? -1) + 1);
  const variables = snapshot.chat.stCompatibility?.greetingVariables?.[swipe];
  let parent = await fingerprint({ card: snapshot.card, greeting: snapshot.greeting, user: snapshot.user,
    settings: snapshot.settings, books: snapshot.books, preset: snapshot.preset, greetingVariables: variables });
  let state = variables ? {variables: structuredClone(variables)} : {};
  const updates = [];
  const states = [];
  for (let index = 0; index < end; index++) {
    const message = snapshot.chat.message[index];
    const lineage = await fingerprint([parent, message.chatId, message.role, message.data, message.disabled, message.isComment]);
    if (message.stCompatibility?.lineage === lineage) state = structuredClone(message.stCompatibility.state);
    else {
      state = await replay({ message, index, state: structuredClone(state) });
      updates.push({ index, lineage, state: structuredClone(state) });
    }
    parent = lineage;
    states.push(structuredClone(state));
  }
  return { state, lineage: parent, updates, states };
}

export async function messageLineage(parent, message) {
  return fingerprint([parent, message.chatId, message.role, message.data, message.disabled, message.isComment]);
}
