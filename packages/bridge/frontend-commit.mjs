const invalidateFollowing = (chat, item) => {
  for (const next of chat.message.slice(chat.message.indexOf(item) + 1)) if (next.stCompatibility) delete next.stCompatibility.lineage;
};

export function applyFrontendMessageCommit(chat, operation) {
  if (operation.messageId === null) {
    chat.stCompatibility ??= {};
    if (operation.after.swipe_id !== undefined) chat.stCompatibility.greetingSwipe = operation.after.swipe_id;
    if (operation.after.message !== undefined) chat.stCompatibility.greetingMessage = operation.after.message;
    if (operation.after.data !== undefined) {
      chat.stCompatibility.greetingVariables ??= [];
      chat.stCompatibility.greetingVariables[operation.after.swipe_id ?? 0] = operation.after.data;
    }
    return;
  }
  const id = String(operation.messageId ?? '');
  const item = operation.messageId == null ? undefined : id.startsWith('legacy:')
    ? chat.message[Number(id.slice(7))] : chat.message.find(message => message.chatId === operation.messageId);
  if (!item) throw new Error('消息已删除');
  invalidateFollowing(chat, item);
  const { after, before } = operation;
  const fields = { ...after };
  for (const key of ['message_id', 'storage_id', 'role', 'is_hidden', 'message', 'data', 'swipe_id', 'swipes', 'swipes_data', 'swipes_info']) delete fields[key];
  Object.assign(item, fields);
  if (after.role !== undefined) item.role = after.role === 'assistant' ? 'char' : 'user';
  if (after.message !== undefined) item.data = after.message;
  if (after.is_hidden !== before?.is_hidden) item.disabled = after.is_hidden ? true : false;
  if (after.swipes !== undefined || after.swipes_data !== undefined || after.swipes_info !== undefined) {
    item.stCompatibility ??= {};
    item.stCompatibility.swipes = {
      messages: after.swipes ?? item.stCompatibility.swipes?.messages ?? [item.data],
      data: after.swipes_data ?? item.stCompatibility.swipes?.data ?? [],
      info: after.swipes_info ?? item.stCompatibility.swipes?.info ?? [],
      current: after.swipe_id ?? item.stCompatibility.swipes?.current ?? 0,
    };
  }
  if (after.swipe_id !== undefined || after.swipes !== undefined) {
    const swipes = after.swipes ?? item.stCompatibility?.swipes?.messages ?? [item.data];
    const swipeId = after.swipe_id ?? item.stCompatibility?.swipes?.current ?? 0;
    if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId >= swipes.length) throw new RangeError('swipe 索引不存在');
    item.stCompatibility ??= {};
    item.stCompatibility.swipes ??= { messages: swipes, data: [], info: [], current: swipeId };
    item.stCompatibility.swipes.messages = swipes;
    item.stCompatibility.swipes.current = swipeId;
    item.data = swipes[swipeId];
    item.stCompatibility.state ??= {};
    if (item.stCompatibility.swipes.data[swipeId] !== undefined) item.stCompatibility.state.variables = item.stCompatibility.swipes.data[swipeId];
    else item.stCompatibility.swipes.data[swipeId] = item.stCompatibility.state.variables ?? {};
  }
  if (after.data !== undefined) {
    item.stCompatibility ??= {};
    item.stCompatibility.state ??= {};
    item.stCompatibility.swipes ??= { messages: [item.data], data: [item.stCompatibility.state.variables], info: [], current: after.swipe_id ?? 0 };
    item.stCompatibility.swipes.data[after.swipe_id ?? item.stCompatibility.swipes.current ?? 0] = after.data;
    item.stCompatibility.state.variables = after.data;
  }
}

export function applyFrontendVariableCommit(chat, scope, variables, binding = {}) {
  const match = String(scope ?? '').match(/^message:(.*):(\d+)$/);
  if (match) {
    const swipeId = Number(match[2]);
    if (match[1] === '0') {
      chat.stCompatibility ??= {};
      chat.stCompatibility.greetingVariables ??= [];
      chat.stCompatibility.greetingVariables[swipeId] = variables;
      return true;
    }
    const item = match[1].startsWith('legacy:')
      ? chat.message[Number(match[1].slice(7))] : chat.message.find(message => message.chatId === match[1]);
    if (!item) throw new Error('消息已删除');
    invalidateFollowing(chat, item);
    item.stCompatibility ??= {};
    item.stCompatibility.state ??= {};
    item.stCompatibility.swipes ??= { messages: [item.data], data: [], info: [], current: swipeId };
    item.stCompatibility.swipes.data[swipeId] = variables;
    if (item.stCompatibility.swipes.current === swipeId) item.stCompatibility.state.variables = variables;
    return true;
  }
  const nested = String(scope ?? '').match(/^(script|extension):(.*)$/);
  if (nested) {
    const key = nested[1] === 'script' ? 'scriptVariables' : 'extensionVariables';
    binding[key] ??= {};
    binding[key][nested[2]] = variables;
    return true;
  }
  return false;
}

export function applyFrontendStorageCommit(binding, operation) {
  binding.localStorage ??= {};
  if (operation.operation === 'set') binding.localStorage[operation.key] = operation.value;
  else if (operation.operation === 'remove') delete binding.localStorage[operation.key];
  else if (operation.operation === 'clear') binding.localStorage = {};
  else throw new Error('未知本地存储操作');
  return binding.localStorage;
}
