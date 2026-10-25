export function frameView(snapshot, result, index) {
  const greetingSwipe = snapshot.chat.stCompatibility?.greetingSwipe ?? Math.max(0, (snapshot.chat.fmIndex ?? -1) + 1);
  const messages = [{ message_id: 0, storage_id: null, role: 'assistant',
    message: snapshot.chat.stCompatibility?.greetingMessage ?? snapshot.greeting ?? '',
    data: snapshot.chat.stCompatibility?.greetingVariables?.[greetingSwipe] ?? result.initialVariables ?? {}, swipe_id: greetingSwipe,
    swipes_data: snapshot.chat.stCompatibility?.greetingVariables ?? [result.initialVariables ?? {}] },
    ...snapshot.chat.message.map((item, messageIndex) => {
      const swipeId = item.stCompatibility?.swipes?.current ?? 0;
      const variables = result.states?.[messageIndex]?.variables ?? item.stCompatibility?.swipes?.data?.[swipeId] ?? item.stCompatibility?.state?.variables ?? {};
      const swipesData = [...item.stCompatibility?.swipes?.data ?? []]; swipesData[swipeId] = variables;
      return { message_id: messageIndex + 1, storage_id: item.chatId ?? `legacy:${messageIndex}`,
      role: item.role === 'char' ? 'assistant' : 'user', message: item.data ?? '',
      data: variables,
      is_hidden: item.disabled === true || item.disabled === 'allBefore',
      swipe_id: item.stCompatibility?.swipes?.current ?? 0,
      swipes_data: swipesData,
      ...(item.stCompatibility?.swipes ? { swipes: item.stCompatibility.swipes.messages,
        swipes_info: item.stCompatibility.swipes.info } : {}) };
    })];
  const scopes = { chat: result.variables ?? {}, global: result.globals ?? {}, character: snapshot.state?.character ?? {},
    preset: snapshot.preset ?? {}, script: snapshot.scriptVariables ?? {}, extension: snapshot.extensionVariables ?? {} };
  return { currentMessageId: index + 1, scriptId: `st-compat:${snapshot.characterId ?? 'card'}`,
    chatId: snapshot.chat.id, user: snapshot.user, name: snapshot.card?.data?.name ?? snapshot.card?.name ?? '',
    scopes, messages, worldbooks: snapshot.books ?? {}, localStorage: snapshot.localStorage ?? {},
    primaryWorldbook: snapshot.card?.data?.character_book?.name };
}
