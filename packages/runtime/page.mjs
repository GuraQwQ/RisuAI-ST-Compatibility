import { generateTransaction } from '../bridge/transaction.mjs';
import { framePart } from '../bridge/frame.mjs';
import { frameView } from '../bridge/view.mjs';
import { applyFrontendMessageCommit, applyFrontendStorageCommit, applyFrontendVariableCommit } from '../bridge/frontend-commit.mjs';
import { assetSnapshot, assetSettings, presetOrder } from '../core/assets.mjs';

const pluginName = 'risu-st-compatibility';
const clone = value => JSON.parse(JSON.stringify(value));
const assetRevision = binding => JSON.stringify([binding.presetHash, binding.presetOrderId, binding.presetToggles,
  binding.macroEngine, binding.worldbookHashes]);

export function startRuntimePage() {
  if (globalThis.__stCompatibilityRuntime) return { reused: true };
  const native = globalThis.__stCompatibilityNative;
  if (!native) throw new Error('原生接口尚未接通');
  const waiting = new Map(), controllers = new Set(), mounts = new Map(), frames = new Map();
  const reports = new Map();
  let serial = 0, scheduled = false;
  const call = (method, payload, signal) => new Promise((resolve, reject) => {
    const id = ++serial;
    const cancel = () => {
      waiting.delete(id); clearTimeout(timer);
      globalThis.__stCompatibilityCall(JSON.stringify({ method: 'cancel', payload: { id } }));
      reject(signal.reason ?? new Error('已取消'));
    };
    const timer = setTimeout(() => { waiting.delete(id); signal?.removeEventListener('abort', cancel); reject(new Error('运行层连接超时，请从酒馆运行层入口重新启动')); }, 65000);
    waiting.set(id, { resolve: result => { signal?.removeEventListener('abort', cancel); resolve(result); },
      reject: error => { signal?.removeEventListener('abort', cancel); reject(error); }, timer });
    if (signal?.aborted) cancel();
    else {
      signal?.addEventListener('abort', cancel, { once: true });
      globalThis.__stCompatibilityCall(JSON.stringify({ id, method, payload }));
    }
  });
  const character = () => native.db().characters[native.selected()];
  const active = value => {
    if (!native.db().plugins.some(p => p.name === pluginName && p.enabled)) return false;
    const selected = character();
    const target = typeof value === 'string' ? native.db().characters.find(c => c.chaId === value) ?? (selected?.name === value ? selected : null)
      : value?.chaId ? native.db().characters.find(c => c.chaId === value.chaId) : value ?? selected;
    return target?.stCompatibility?.enabled === true;
  };
  const snapshot = (target = character(), operation = 'normal') => {
    target = native.db().characters.find(c => c.chaId === target.chaId);
    if (!target) throw new Error('角色已被移除');
    const db = native.db(), chat = target.chats[target.chatPage], binding = target.stCompatibility;
    return clone({ card: binding.card, chat, user: native.parser('{{user}}', { chara: target }),
      maxContext: db.maxContext ?? 8192, maxResponse: db.maxResponse ?? 0, settings: binding.settings ?? {},
      persona: binding.persona ?? '', ...assetSnapshot(binding, db.stCompatibilityAssets),
      assetRevision: assetRevision(binding),
      globalRegex: binding.globalRegex,
      model: db.aiModel,
      localStorage: binding.localStorage ?? {}, scriptVariables: binding.scriptVariables ?? {},
      extensionVariables: binding.extensionVariables ?? {}, extensionId: 'st-compatibility',
      state: chat.stCompatibility?.state ?? [...chat.message].reverse().find(m => m.stCompatibility?.state)?.stCompatibility.state ?? {},
      selected: native.selected(), characterId: target.chaId, chatIndex: target.chatPage,
      provider: binding.provider, localResponse: binding.localResponse,
      greeting: chat.fmIndex >= 0 ? target.alternateGreetings[chat.fmIndex] : target.firstMessage, operation });
  };
  const evaluate = (message, signal) => call('evaluate', message, signal);
  const revision = chat => JSON.stringify([chat.message, chat.stCompatibility]);
  const stateOf = result => ({ variables: result.variables, globals: result.globals, metadata: result.metadata });
  const persist = (chat, result) => { chat.stCompatibility ??= {}; chat.stCompatibility.state = stateOf(result); };
  const publish = (chatId, events = [], origin) => {
    for (const entry of frames.values()) if (entry.chatId === chatId && entry.part.id !== origin) {
      for (const event of events) entry.node.contentWindow?.postMessage({ channel: entry.part.id, event: { ...event, origin } }, '*');
    }
  };
  const refreshViews = chatId => {
    if (!active()) return;
    const current = snapshot();
    if (current.chat.id !== chatId) return;
    for (const entry of frames.values()) if (entry.chatId === chatId) {
      entry.snapshot = current; entry.revision = revision(current.chat);
      entry.view = frameView(current, { ...entry.result, states: undefined, variables: current.state.variables, globals: current.state.globals }, entry.index);
      entry.node.contentWindow?.postMessage({ channel: entry.part.id, view: entry.view }, '*');
    }
  };
  const reportError = error => {
    console.error('[酒馆运行层]', error);
    let node = document.getElementById('st-compatibility-error');
    if (!node) {
      node = document.createElement('p'); node.id = 'st-compatibility-error'; node.setAttribute('role', 'alert');
      Object.assign(node.style, { position: 'fixed', bottom: '70px', right: '20px', maxWidth: '600px', zIndex: '9999', padding: '12px', background: '#39272b', color: '#fff' });
      node.onclick = () => node.remove(); document.body.append(node);
    }
    node.textContent = String(error.message ?? error);
  };
  const prepareInput = async (target, signal) => {
    const chat = target.chats[target.chatPage], last = chat.message.at(-1);
    if (last?.role !== 'user' || last.stCompatibility?.raw !== undefined) return;
    last.chatId ??= crypto.randomUUID();
    const before = revision(chat), input = snapshot(target);
    input.chat.message.pop();
    const result = await evaluate({ operation: 'input', snapshot: input, text: last.data, outputMessage: clone(last) }, signal);
    signal?.throwIfAborted();
    if (revision(chat) !== before) throw new Error('输入处理期间聊天已改变，请重试');
    const raw = last.data;
    Object.assign(last, { data: result.text, stCompatibility: { raw, lineage: result.lineage, state: stateOf(result) } });
    for (const update of result.historyUpdates ?? []) Object.assign(chat.message[update.index].stCompatibility ??= {}, update);
    persist(chat, result);
    publish(chat.id, [{ name: 'message_sent', args: [chat.message.length] }]);
  };
  const request = async (current, messages, signal) => {
    signal?.throwIfAborted();
    if (current.provider === 'local') return current.localResponse;
    const result = await native.request({ formated: messages, bias: {}, currentChar: character(), useStreaming: native.db().useStreaming, blockPlugins: false }, 'model', signal);
    if (result.type === 'fail') throw new Error(result.result);
    if (result.type === 'success') return result.result;
    if (result.type === 'multiline') return result.result.map(item => item[1]).join('\n');
    if (result.type !== 'streaming') throw new Error('未知模型返回类型');
    const reader = result.result.getReader();
    let output = '';
    try {
      for (;;) {
        signal?.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        output = chunk.value['0'] ?? output;
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return output;
  };
  const send = async (original, processIndex = -1, arg = {}) => {
    const target = character();
    if (!active(target)) return original(processIndex, arg);
    if (native.isBusy()) return false;
    if (processIndex !== -1) throw new Error('兼容运行暂不支持群聊');
    const controller = new AbortController(); controllers.add(controller);
    const signal = arg.signal ? AbortSignal.any([arg.signal, controller.signal]) : controller.signal;
    const operation = arg.continue ? 'continue' : 'normal';
    let chat = target.chats[target.chatPage]; chat.id ??= crypto.randomUUID();
    native.busy(true);
    try {
      await prepareInput(target, signal);
      const outputMessage = arg.continue && chat.message.at(-1)?.role === 'char'
        ? { ...clone(chat.message.at(-1)), time: Date.now() }
        : { role: 'char', saying: target.chaId, chatId: crypto.randomUUID(), time: Date.now() };
      let current;
      const result = await generateTransaction({ id: `${target.chaId}/${chat.id}`, signal,
        preview: !!(arg.preview || arg.previewPrompt), read: () => snapshot(target, operation),
        build: input => { current = input; return evaluate({ operation: 'prompt', snapshot: input }, signal); },
        provider: messages => {
          if (JSON.stringify(snapshot(target, operation)) !== JSON.stringify(current)) throw new Error('构建期间聊天已改变，未调用模型');
          return request(current, messages, signal);
        },
        prepare: ({ response, prompt, snapshot: input }) => evaluate({ operation: 'output', outputMessage,
          parentLineage: prompt.lineage, text: operation === 'continue' ? (input.chat.message.at(-1)?.stCompatibility?.raw ?? input.chat.message.at(-1)?.data ?? '') + response : response,
          snapshot: { ...input, state: { variables: prompt.variables, globals: prompt.globals, metadata: prompt.metadata } } }, signal),
        retain: conflict => call('retain', { characterId: target.chaId, chatId: chat.id, conflict }),
        commit: ({ response, prompt, prepared }) => {
          chat = native.db().characters.find(c => c.chaId === target.chaId).chats.find(c => c.id === chat.id);
          for (const update of prompt.historyUpdates ?? []) Object.assign(chat.message[update.index].stCompatibility ??= {}, update);
          const message = { ...outputMessage, data: prepared.text, stCompatibility: { raw: operation === 'continue'
            ? (chat.message.at(-1)?.stCompatibility?.raw ?? chat.message.at(-1)?.data ?? '') + response : response,
          state: stateOf(prepared), lineage: prepared.lineage } };
          if (operation === 'continue' && chat.message.at(-1)?.role === 'char') chat.message[chat.message.length - 1] = message;
          else chat.message.push(message);
          persist(chat, prepared); refreshViews(chat.id);
          publish(chat.id, [...prepared.events ?? [], { name: 'message_received', args: [chat.message.length, 'normal'] }]);
        },
      });
      if (result.status === 'preview') native.preview(JSON.stringify({ messages: result.prompt.messages }));
      reports.set(chat.id, { status: result.status, messages: result.prompt?.messages, tokens: result.prompt?.tokens,
        budgetMethod: current?.provider === 'local' ? 'Unicode 字符与固定消息开销估算' : 'Risu 当前 tokenizer' });
      if (result.status === 'conflict') reportError(new Error('聊天已发生变化，生成结果已保存到本地冲突记录'));
      return result.status === 'committed' || result.status === 'preview';
    } catch (error) {
      if (!signal.aborted) reportError(error);
      return false;
    } finally { controllers.delete(controller); native.busy(false); schedule(); }
  };
  const command = async (name, payload = {}) => {
    if (name === 'enable') return true;
    if (name === 'assets') {
      let binding = character()?.stCompatibility ?? {};
      const assets = native.db().stCompatibilityAssets ?? {};
      if (payload.presetHash !== undefined) binding = { ...binding, presetHash: payload.presetHash,
        presetOrderId: payload.orderId, presetToggles: {}, macroEngine: assets[payload.presetHash]?.macroEngine ?? 'legacy' };
      return assetSettings(binding, assets);
    }
    if (name === 'importAsset') return call('importAsset', payload);
    if (name === 'assetSettings') {
      const binding = character()?.stCompatibility;
      if (!binding) throw new Error('请先选择已导入的兼容角色');
      const assets = native.db().stCompatibilityAssets ?? {};
      if (payload.presetHash && assets[payload.presetHash]?.kind !== 'preset') throw new Error('预设尚未导入');
      if (!['modern', 'legacy'].includes(payload.macroEngine)) throw new Error('宏引擎无效');
      if (!Array.isArray(payload.worldbookHashes) || payload.worldbookHashes.some(hash => assets[hash]?.kind !== 'worldbook')) throw new Error('世界书尚未导入');
      const imported = assets[payload.presetHash];
      const order = imported && presetOrder(imported.data, payload.orderId);
      const toggles = payload.toggles ?? {};
      if (Object.values(toggles).some(value => typeof value !== 'boolean') || Object.keys(toggles).some(id => !order?.order.some(item => item.identifier === id))) throw new Error('预设开关无效');
      Object.assign(binding, { presetHash: payload.presetHash, presetOrderId: order?.character_id,
        presetToggles: toggles, macroEngine: payload.macroEngine, worldbookHashes: [...new Set(payload.worldbookHashes)] });
      schedule();
      return assetSettings(binding, assets);
    }
    if (name === 'current') {
      const binding = character()?.stCompatibility;
      return binding ? { provider: binding.provider, localResponse: binding.localResponse } : null;
    }
    if (name === 'configure') {
      const binding = character()?.stCompatibility;
      if (!binding) throw new Error('请先选择已导入的兼容角色');
      if (!['local', 'risu'].includes(payload.provider) || typeof payload.localResponse !== 'string') throw new Error('角色连接设置无效');
      binding.provider = payload.provider; binding.localResponse = payload.localResponse;
      return true;
    }
    if (name === 'status') return { connected: true, enabled: native.db().plugins.some(p => p.name === pluginName && p.enabled), activeCharacter: active(), reports: [...reports.values()] };
    if (name === 'preview') return call('preview', payload);
    if (name === 'import') return call('import', payload);
    throw new Error(`未知兼容命令：${name}`);
  };
  const pluginMessage = async event => {
    const data = event.data;
    if (data?.channel !== 'st-compatibility-plugin') return;
    if (event.source !== native.pluginWindow(pluginName)) return;
    const reply = { channel: data.channel, requestId: data.requestId };
    try { reply.result = await command(data.command, data.payload); }
    catch (error) { reply.error = String(error.message); }
    event.source.postMessage(clone(reply), '*');
  };
  const findContext = entry => {
    const target = native.db().characters.find(c => c.chaId === entry.characterId);
    const chat = target?.chats.find(c => c.id === entry.chatId);
    if (!active(target) || target !== character() || chat !== target.chats[target.chatPage]) throw new Error('状态栏所属聊天已切换');
    return { target, chat };
  };
  const frameMessage = async event => {
    const { channel, method, args = [], requestId } = event.data ?? {};
    const entry = frames.get(channel);
    if (!entry || entry.node.contentWindow !== event.source) return;
    if (method === 'resize') { entry.node.style.height = `${Math.max(100, Math.min(4000, Number(args[0]) || 100))}px`; return; }
    const reply = { channel, requestId };
    try {
      const { target, chat } = findContext(entry);
      if (method === 'commit') {
        if (entry.revision !== revision(chat)) throw new Error('消息已更新，请刷新状态栏后重试');
        const change = args[0];
        if (change.kind === 'variables') {
          const handled = applyFrontendVariableCommit(chat, change.scope, change.after, target.stCompatibility);
          if (!handled && ['chat', 'global'].includes(change.scope)) {
            chat.stCompatibility ??= {}; chat.stCompatibility.state ??= {};
            chat.stCompatibility.state[change.scope === 'chat' ? 'variables' : 'globals'] = change.after;
          } else if (!handled && change.scope.startsWith('script:')) {
            target.stCompatibility.scriptVariables ??= {}; target.stCompatibility.scriptVariables[change.scope.slice(7)] = change.after;
          } else if (!handled && change.scope.startsWith('extension:')) {
            target.stCompatibility.extensionVariables ??= {}; target.stCompatibility.extensionVariables[change.scope.slice(10)] = change.after;
          } else if (!handled) target.stCompatibility[change.scope] = change.after;
        } else if (change.kind === 'message') applyFrontendMessageCommit(chat, { ...change,
          before: entry.view.messages.find(m => String(m.storage_id ?? m.message_id) === String(change.messageId ?? 0)) });
        else if (change.kind === 'storage') applyFrontendStorageCommit(target.stCompatibility, change);
        else if (change.kind === 'worldbook') { target.stCompatibility.books ??= {}; target.stCompatibility.books[change.name] = change.after; }
        else throw new Error(`尚未支持的写操作：${change.kind}`);
        refreshViews(chat.id);
        if (change.kind === 'variables') publish(chat.id, change.events, channel);
        if (change.kind === 'message') publish(chat.id, [{ name: 'message_updated', args: [change.after.message_id] }], channel);
        if (change.kind === 'storage') publish(chat.id, [{ name: 'st_local_storage_changed', args: [change] }], channel);
        reply.result = true; schedule();
      } else if (method === 'event') {
        publish(chat.id, [{ name: args[0]?.name, args: args[0]?.args ?? [] }], channel); reply.result = true;
      } else if (method === 'parseMvu') {
        const input = snapshot(target);
        input.state.variables = args[0].variables;
        const result = await evaluate({ operation: 'parseMvu', snapshot: input, text: args[0].text });
        reply.result = { variables: result.variables, events: result.events };
      } else if (method === 'generate' || method === 'generateRaw') {
        const input = snapshot(target), config = args[0] ?? {};
        if (config.user_input) input.chat.message.push({ role: 'user', data: config.user_input, chatId: crypto.randomUUID() });
        const prompt = await evaluate({ operation: 'prompt', snapshot: input });
        reply.result = await request(input, prompt.messages);
      } else if (method === 'diagnostic') { console.warn('[角色前端]', ...args); reply.result = true; }
      else throw new Error(`尚未支持前端接口：${method}`);
    } catch (error) { reply.error = String(error.message); }
    entry.node.contentWindow?.postMessage(clone(reply), '*');
  };
  const cleanupMount = mount => {
    for (const part of mount.parts) frames.delete(part.id);
    mount.container.remove(); mount.body.style.display = mount.display;
  };
  const render = async mount => {
    if (mount.pending || native.isBusy() || !active()) return;
    const target = character(), chat = target.chats[target.chatPage], index = Number(mount.body.closest('.risu-chat').dataset.chatIndex);
    const message = chat.message[index];
    const source = index < 0 ? chat.stCompatibility?.greetingMessage ?? (chat.fmIndex >= 0 ? target.alternateGreetings[chat.fmIndex] : target.firstMessage) : message?.data;
    if (source === undefined) return;
    const key = JSON.stringify([target.stCompatibility.hash, chat.id, index, source, chat.fmIndex, message?.stCompatibility,
      chat.stCompatibility, target.stCompatibility.localStorage, chat.message.length, assetRevision(target.stCompatibility)]);
    if (mount.key === key) return;
    mount.pending = true;
    try {
      const input = snapshot(target), result = await evaluate({ operation: 'display', snapshot: input, text: source, index, role: message?.role ?? 'char' });
      if (!mount.body.isConnected || character()?.chaId !== target.chaId || target.chats[target.chatPage].id !== input.chat.id
        || revision(chat) !== revision(input.chat) || assetRevision(target.stCompatibility) !== input.assetRevision) return;
      const next = [];
      for (const segment of result.text.split(/(```(?:html)?\s*\n[\s\S]*?```)/gi)) {
        if (!segment.trim()) continue;
        if (/^```/i.test(segment) && /<(?:html|script|!doctype)\b/i.test(segment)) {
          const html = segment.replace(/^```(?:html)?\s*\n/i, '').replace(/```$/, '');
          const view = frameView(input, result, index), identity = JSON.stringify([target.chaId, chat.id, message?.chatId ?? index, message?.stCompatibility?.swipes?.current ?? chat.fmIndex]);
          const part = framePart(html, view, identity, mount.parts[next.length], globalThis.__stCompatibilityFrameLibraries);
          let entry = frames.get(part.id);
          if (!entry) {
            const node = document.createElement('iframe'); node.title = '角色状态栏'; node.setAttribute('sandbox', 'allow-scripts');
            node.style.cssText = 'width:100%;height:480px;border:0;display:block'; node.srcdoc = part.source;
            entry = { node, part, characterId: target.chaId, chatId: chat.id, messageId: message?.chatId ?? null, index };
            frames.set(part.id, entry);
          }
          Object.assign(entry, { snapshot: input, result, view, revision: revision(chat) });
          entry.node.contentWindow?.postMessage({ channel: part.id, view }, '*');
          next.push(part);
        } else next.push({ id: crypto.randomUUID(), html: await native.render(segment, target, 'normal', index) });
      }
      for (const old of mount.parts) if (!next.some(p => p.id === old.id)) { frames.get(old.id)?.node.remove(); frames.delete(old.id); }
      if (mount.problem) { mount.container.replaceChildren(); mount.problem = false; }
      const desired = next.map(part => {
        if (part.source) return frames.get(part.id).node;
        const node = document.createElement('div'); node.innerHTML = part.html; return node;
      });
      for (let i = 0; i < desired.length; i++) if (mount.container.children[i] !== desired[i]) mount.container.insertBefore(desired[i], mount.container.children[i] ?? null);
      while (mount.container.children.length > desired.length) mount.container.lastElementChild.remove();
      mount.parts = next; mount.key = key;
    } catch (error) {
      if (mount.body.isConnected) {
        for (const part of mount.parts) frames.delete(part.id);
        mount.parts = [];
        mount.container.textContent = String(error.message);
        const retry = document.createElement('button'); retry.textContent = '重试状态栏';
        retry.onclick = () => { mount.key = null; schedule(); }; mount.container.append(retry);
        mount.key = key; mount.problem = true;
      }
    }
    finally { mount.pending = false; }
  };
  const scan = () => {
    const enabled = active();
    if (!enabled) for (const controller of controllers) controller.abort();
    for (const [body, mount] of mounts) if (!body.isConnected || !enabled) { cleanupMount(mount); mounts.delete(body); }
    if (!enabled) return;
    for (const body of document.querySelectorAll('.risu-chat[data-chat-index] .chattext:not([data-st-compatibility])')) {
      let mount = mounts.get(body);
      if (!mount) {
        const container = document.createElement('div'); container.className = body.className; container.dataset.stCompatibility = 'renderer';
        container.style.fontSize = body.style.fontSize; container.style.lineHeight = body.style.lineHeight;
        mount = { body, container, display: body.style.display, parts: [], key: null, pending: false };
        body.style.display = 'none'; body.after(container); mounts.set(body, mount);
      }
      void render(mount);
    }
  };
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; scan(); }); } }
  const observer = new MutationObserver(schedule); observer.observe(document.body, { childList: true, subtree: true });
  const interval = setInterval(scan, 500);
  window.addEventListener('message', pluginMessage); window.addEventListener('message', frameMessage);
  const runtime = globalThis.__stCompatibilityRuntime = { active, send, snapshot, command,
    isLocal: () => active() && character()?.stCompatibility?.provider === 'local',
    resolve(id, result, error) {
      const pending = waiting.get(id); if (!pending) return;
      waiting.delete(id); clearTimeout(pending.timer);
      error ? pending.reject(new Error(error)) : pending.resolve(result);
    },
    count: payload => payload.messages ? new native.Tokenizer(4, 'name').tokenizeChats(Array.isArray(payload.messages) ? payload.messages : [payload.messages])
      : new native.Tokenizer(0, 'name').tokenizeChat({ role: 'system', content: payload.text }),
    installAsset(asset) {
      const db = native.db(); db.stCompatibilityAssets ??= {};
      const reused = !!db.stCompatibilityAssets[asset.hash];
      db.stCompatibilityAssets[asset.hash] ??= asset;
      const binding = character()?.stCompatibility;
      if (binding && asset.kind === 'preset' && binding.presetHash !== asset.hash) Object.assign(binding, {
        presetHash: asset.hash, presetOrderId: asset.orderId, presetToggles: {}, macroEngine: asset.macroEngine });
      if (binding && asset.kind === 'worldbook') binding.worldbookHashes = [...new Set([...binding.worldbookHashes ?? [], asset.hash])];
      schedule();
      return { reused, applied: !!binding, settings: assetSettings(binding ?? {}, db.stCompatibilityAssets) };
    },
    publishCharacter(value) {
      const db = native.db(), existing = db.characters.find(c => c.stCompatibility?.hash === value.stCompatibility.hash);
      if (!existing) db.characters.push(value);
      native.order();
      return { id: (existing ?? value).chaId, reused: !!existing };
    },
    selectCharacter(id) { native.select(native.db().characters.findIndex(c => c.chaId === id)); },
    createCharacter(data) {
      const value = native.blank();
      Object.assign(value, data); value.chats[0].id = crypto.randomUUID(); value.chats[0].fmIndex = -1;
      return clone(value);
    },
    async installPlugin(script) {
      const db = native.db();
      const versionOfPlugin = script.match(/^\/\/@version\s+(\S+)/m)?.[1];
      let plugin = db.plugins.find(p => p.name === pluginName);
      if (plugin && plugin.script !== script) {
        plugin.script = script; plugin.version = '3.0'; plugin.versionOfPlugin = versionOfPlugin;
        return { name: pluginName, reload: true };
      }
      if (!plugin) {
        plugin = { name: pluginName, displayName: '酒馆运行层', version: '3.0', versionOfPlugin,
          enabled: true, script, arguments: {}, realArg: {}, customLink: [] }; db.plugins.push(plugin);
      }
      if (plugin.enabled) await native.executePlugin(plugin);
      if (plugin.enabled && !native.pluginWindow(pluginName)) throw new Error('无法定位兼容插件的原生容器');
      return { name: pluginName };
    },
    dispose() {
      for (const controller of controllers) controller.abort();
      observer.disconnect(); clearInterval(interval);
      window.removeEventListener('message', pluginMessage); window.removeEventListener('message', frameMessage);
      for (const mount of mounts.values()) cleanupMount(mount);
      for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('运行层已结束')); }
      waiting.clear(); native.restore(); delete globalThis.__stCompatibilityRuntime;
    },
  };
  schedule();
  return { installed: true };
}
