import { generateTransaction } from '../bridge/transaction.mjs';
import { framePart } from '../bridge/frame.mjs';
import { frameView } from '../bridge/view.mjs';
import { applyFrontendMessageCommit, applyFrontendStorageCommit, applyFrontendVariableCommit } from '../bridge/frontend-commit.mjs';
import { assetSnapshot, assetSettings, presetOrder } from '../core/assets.mjs';
import { createTavernHost } from './tavern-host.mjs';
import { createSlashExecutor } from './slash.mjs';
import { applyGenerationConfig, attachGenerationImages } from '../core/generation.mjs';
import { iframeEvents } from '../core/frontend-events.mjs';

const pluginName = 'risu-st-compatibility';
const clone = value => JSON.parse(JSON.stringify(value));
const assetRevision = binding => JSON.stringify([binding.presetHash, binding.presetOrderId, binding.presetToggles,
  binding.macroEngine, binding.worldbookHashes]);

export function startRuntimePage() {
  if (globalThis.__stCompatibilityRuntime) return { reused: true };
  const native = globalThis.__stCompatibilityNative;
  if (!native) throw new Error('原生接口尚未接通');
  const waiting = new Map(), controllers = new Set(), mounts = new Map(), frames = new Map();
  const generations = new Map();
  const eventAcks = new Map();
  const scriptFrames = new Map();
  const observations = new Map();
  let frontendOwnsBusy = false;
  const reports = new Map();
  let serial = 0, scheduled = false;
  const call = (method, payload, signal) => new Promise((resolve, reject) => {
    const id = ++serial;
    const cancel = () => {
      waiting.delete(id); clearTimeout(timer);
      globalThis.__stCompatibilityCall(JSON.stringify({ method: 'cancel', payload: { id } }));
      reject(signal.reason ?? new Error('已取消'));
    };
    const timer = setTimeout(() => { waiting.delete(id); signal?.removeEventListener('abort', cancel); reject(new Error('运行层连接超时，请从酒馆运行层入口重新启动')); }, method === 'customGenerate' ? 1800000 : 65000);
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
    const hostData = tavernHost.snapshotData(target, chat);
    const stored = chat.stCompatibility?.state ?? [...chat.message].reverse().find(m => m.stCompatibility?.state)?.stCompatibility.state ?? {};
    db.stCompatibilityHost.variables ??= clone(stored.globals ?? {});
    const card = clone(binding.card);
    if (binding.regexEnabled === false) (card.data ?? card).extensions = { ...(card.data ?? card).extensions, regex_scripts: [] };
    return clone({ card: binding.card, chat, user: native.parser('{{user}}', { chara: target }),
      maxContext: db.maxContext ?? 8192, maxResponse: db.maxResponse ?? 0, settings: binding.settings ?? {},
      persona: binding.persona ?? db.personaPrompt ?? '', ...assetSnapshot(binding, db.stCompatibilityAssets),
      assetRevision: assetRevision(binding),
      ...hostData, card, settings: { ...binding.settings, ...hostData.settings },
      model: db.aiModel,
      localStorage: binding.localStorage ?? {}, scriptVariables: binding.scriptVariables ?? {},
      characterVariables: binding.character ?? (card.data ?? card).extensions?.tavern_helper?.variables ?? {},
      presetVariables: db.stCompatibilityAssets?.[binding.presetHash]?.data.extensions?.tavern_helper?.variables ?? db.stCompatibilityHost.defaultPresetVariables ?? {},
      extensionVariables: binding.extensionVariables ?? {}, extensionId: 'st-compatibility',
      state: { ...stored, globals: db.stCompatibilityHost.variables },
      selected: native.selected(), characterId: target.chaId, chatIndex: target.chatPage,
      provider: binding.provider, localResponse: binding.localResponse,
      greeting: chat.fmIndex >= 0 ? target.alternateGreetings[chat.fmIndex] : target.firstMessage, operation });
  };
  const evaluate = (message, signal) => call('evaluate', message, signal);
  const revision = chat => JSON.stringify([chat.message, chat.stCompatibility]);
  const stateOf = result => ({ variables: result.variables, globals: result.globals, metadata: result.metadata,
    template: result.templateState });
  const applyTemplateEffects = (chat, result) => {
    for (const change of result.messageVariables ?? []) {
      if (change.index < 0) { chat.stCompatibility ??= {}; chat.stCompatibility.greetingVariables = change.variables; }
      else {
        const item = change.storageId ? chat.message.find(item => item.chatId === change.storageId) : chat.message[change.index];
        if (!item) continue;
        item.stCompatibility ??= {}; item.stCompatibility.state ??= {}; item.stCompatibility.state.variables = change.variables[change.swipeId ?? 0] ?? {};
        if (item.stCompatibility.swipes) item.stCompatibility.swipes.data = change.variables;
      }
    }
  };
  const persist = (chat, result) => { chat.stCompatibility ??= {}; chat.stCompatibility.state = stateOf(result);
    native.db().stCompatibilityHost.variables = result.globals ?? native.db().stCompatibilityHost.variables;
    applyTemplateEffects(chat, result);
  };
  const publish = (chatId, events = [], origin) => {
    for (const entry of frames.values()) if (entry.chatId === chatId && entry.part.id !== origin) {
      for (const event of events) entry.node.contentWindow?.postMessage({ channel: entry.part.id, event: { ...event, origin } }, '*');
    }
  };
  const dispatchToFrames = async (chatId, name, args = []) => {
    for (const entry of [...frames.values()]) if (entry.chatId === chatId) {
      const hostEventId = crypto.randomUUID();
      args = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { eventAcks.delete(hostEventId); reject(new Error(`前端事件处理超时：${name}`)); }, 65000);
        eventAcks.set(hostEventId, { channel: entry.part.id, resolve: value => { clearTimeout(timer); resolve(value ?? args); }, reject: error => { clearTimeout(timer); reject(new Error(error)); } });
        entry.node.contentWindow?.postMessage({ channel: entry.part.id, hostEventId, event: { name, args } }, '*');
      });
    }
    return args;
  };
  const resolveInjections = async input => {
    input.extensionPrompts ??= {};
    for (const [key, injection] of globalThis.__stFrontendInjections ?? []) {
      if (injection.chatId !== input.chat.id) continue;
      const prompt = injection.prompt;
      if (!prompt.filter || await prompt.filter()) input.extensionPrompts[prompt.id] = { value: prompt.content,
        position: prompt.position === 'none' ? -1 : 1, depth: prompt.depth, role: ['system', 'user', 'assistant'].indexOf(prompt.role), scan: prompt.should_scan ?? true };
      if (injection.once) globalThis.__stFrontendInjections.delete(key);
    }
    return input;
  };
  const refreshViews = chatId => {
    if (!active()) return;
    const current = snapshot();
    if (current.chat.id !== chatId) return;
    for (const entry of frames.values()) if (entry.chatId === chatId) {
      entry.snapshot = current; entry.revision = revision(current.chat);
      entry.view = { ...frameView(current, { ...entry.result, states: undefined, variables: current.state.variables, globals: current.state.globals }, entry.index),
        tavern: tavernHost.call('getFrontendState', [], entry).tavern, characterId: entry.characterId,
        ...(entry.script ? { scriptId: entry.view.scriptId, scriptName: entry.view.scriptName, scriptOnly: true } : {}) };
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
    Object.assign(last, { data: result.text, stCompatibility: { raw, lineage: result.lineage, state: stateOf(result), templateProcessed: true } });
    for (const update of result.historyUpdates ?? []) Object.assign(chat.message[update.index].stCompatibility ??= {}, update);
    persist(chat, result);
    publish(chat.id, [{ name: 'message_sent', args: [chat.message.length - 1 + Number(!chat.stCompatibility?.greetingMaterialized)] }]);
  };
  const request = async (current, messages, signal, config, onProgress = async () => {}) => {
    signal?.throwIfAborted();
    if (current.provider === 'local') { if (config?.should_stream) await onProgress({ content: current.localResponse ?? '' }); return config?.should_return_reasoning ? { content: current.localResponse ?? '' } : current.localResponse; }
    const connection = config && native.connection?.();
    if (config && (config.custom_api || config.tools?.length || config.json_schema || config.should_return_reasoning) && (connection || config.custom_api?.apiurl)) {
      return call('customGenerate', { messages, config, settings: { ...connection,
        ...(config.preset_name ? current.preset : {}) } }, signal);
    }
    if (config?.tools?.length) throw new Error('当前原生模型连接不提供独立工具调用结果，请指定自定义 API 连接');
    const result = await native.request({ formated: messages, bias: {}, currentChar: character(),
      useStreaming: config ? !!config.should_stream : native.db().useStreaming, forceStreaming: !!config?.should_stream,
      ...(config?.custom_api?.model ? { staticModel: config.custom_api.model } : {}),
      temperature: config?.custom_api?.temperature === 'unset' ? undefined : typeof config?.custom_api?.temperature === 'number' ? config.custom_api.temperature : undefined,
      maxTokens: typeof config?.custom_api?.max_tokens === 'number' ? config.custom_api.max_tokens : undefined,
      schema: config?.json_schema ? JSON.stringify(config.json_schema.value) : undefined,
      blockPlugins: false }, 'model', signal);
    if (result.type === 'fail') throw new Error(result.result);
    if (result.type === 'success') return config?.should_return_reasoning ? reasoningResult(result.result) : result.result;
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
        await onProgress({ content: output });
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return config?.should_return_reasoning ? reasoningResult(output) : output;
  };
  const reasoningResult = text => {
    const match = String(text).match(/^\s*<(Thoughts|thinking|think|reasoning)>\s*([\s\S]*?)\s*<\/\1>\s*/i);
    return match ? { content: text.slice(match[0].length), reasoning: match[2] } : { content: text };
  };
  const frontendGenerate = async (method, supplied, context) => {
    const target = native.db().characters.find(item => item.chaId === context.characterId) ?? character();
    const originalChat = target.chats.find(item => item.id === context.chatId) ?? target.chats[target.chatPage];
    const originalRevision = revision(originalChat);
    const config = clone(supplied ?? {}), id = config.generation_id ?? crypto.randomUUID(); config.generation_id = id;
    if (generations.has(id)) throw new Error(`生成标识正在使用：${id}`);
    const controller = new AbortController(); generations.set(id, { controller, context, config });
    if (!config.should_silence) {
      controllers.add(controller);
      if (!native.isBusy()) { native.busy(true); frontendOwnsBusy = true; }
    }
    const progress = async ({ content = '', reasoning = '' }) => {
      const entry = frames.get(context.frameChannel);
      if (!entry) return;
      const job = generations.get(id);
      for (const [field, value, full, delta] of [['content', content, iframeEvents.STREAM_TOKEN_RECEIVED_FULLY, iframeEvents.STREAM_TOKEN_RECEIVED_INCREMENTALLY],
        ['reasoning', reasoning, iframeEvents.REASONING_TOKEN_RECEIVED_FULLY, iframeEvents.REASONING_TOKEN_RECEIVED_INCREMENTALLY]]) {
        if (!value || job[field] === value) continue;
        const previous = job[field] ?? ''; job[field] = value;
        entry.node.contentWindow?.postMessage({ channel: entry.part.id, event: { name: full, args: [value, id] } }, '*');
        entry.node.contentWindow?.postMessage({ channel: entry.part.id, event: { name: delta, args: [value.startsWith(previous) ? value.slice(previous.length) : value, id] } }, '*');
      }
    };
    try {
      let input = snapshot(target);
      if (config.preset_name && config.preset_name !== 'in_use') {
        const asset = Object.values(native.db().stCompatibilityAssets ?? {}).find(item => item.kind === 'preset' && (item.tavernName ?? item.name) === config.preset_name);
        if (!asset) throw new Error(`预设不存在：${config.preset_name}`);
        input.preset = clone(asset.data); input.promptOrderId = presetOrder(input.preset).character_id;
      }
      if (config.custom_api?.proxy_preset) {
        const proxy = native.db().botPresets?.find(item => item.name === config.custom_api.proxy_preset.trim());
        if (proxy) config.custom_api = { ...config.custom_api, apiurl: proxy.forceReplaceUrl ?? '', key: proxy.proxyKey ?? '' };
      }
      input = applyGenerationConfig(await resolveInjections(input), config, method === 'generateRaw');
      const prompt = await evaluate({ operation: 'prompt', snapshot: input }, controller.signal);
      controller.signal.throwIfAborted();
      const result = await request(input, attachGenerationImages(prompt.messages, input), controller.signal, config, progress);
      controller.signal.throwIfAborted();
      const output = await evaluate({ operation: 'customOutput', text: typeof result === 'string' ? result : result.content,
        snapshot: { ...input, state: stateOf(prompt) } }, controller.signal);
      controller.signal.throwIfAborted();
      const chat = target.chats.find(item => item.id === input.chat.id);
      if (!chat) throw new Error('生成所属聊天已移除');
      if (revision(chat) !== originalRevision) {
        await call('retain', { characterId: target.chaId, chatId: chat.id, conflict: { response: result, prompt: prompt.messages, templateEffects: output } });
        return typeof result === 'string' ? output.text : { ...result, content: output.text };
      }
      // 临时提示词和临时历史不落盘，只提交模板明确产生的变量副作用。
      chat.stCompatibility ??= {}; chat.stCompatibility.state ??= {};
      chat.stCompatibility.state.template = output.templateState;
      chat.stCompatibility.state.metadata = output.metadata;
      native.db().stCompatibilityHost.variables = output.globals;
      applyTemplateEffects(chat, prompt); applyTemplateEffects(chat, output); refreshViews(chat.id);
      return typeof result === 'string' ? output.text : { ...result, content: output.text };
    } finally {
      generations.delete(id); controllers.delete(controller);
      if (frontendOwnsBusy && ![...generations.values()].some(job => !job.config.should_silence)) {
        frontendOwnsBusy = false; native.busy(false); schedule();
      }
    }
  };
  const slashVariables = (scope = 'chat', context = {}, value) => {
    const target = native.db().characters.find(item => item.chaId === context.characterId) ?? character();
    const chat = target.chats.find(item => item.id === context.chatId) ?? target.chats[target.chatPage];
    chat.stCompatibility ??= {}; chat.stCompatibility.state ??= {};
    const owner = scope === 'global' ? native.db().stCompatibilityHost : scope === 'character' ? target.stCompatibility : chat.stCompatibility.state;
    const key = scope === 'character' ? 'character' : 'variables';
    if (value !== undefined) { owner[key] = clone(value); refreshViews(chat.id); }
    return clone(owner[key] ?? {});
  };
  const slash = createSlashExecutor({ call: (...args) => tavernHost.call(...args),
    readVariables: (scope, context) => slashVariables(scope, context), replaceVariables: (value, scope, context) => slashVariables(scope, context, value),
    generate: (config, context) => frontendGenerate(config.raw ? 'generateRaw' : 'generate', config, context), substitute: (text, context) => native.parser(text, { chara: native.db().characters.find(item => item.chaId === context.characterId) ?? character() }),
    setInput: text => { const input = document.querySelector('textarea'); if (input) { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); } },
    reload: () => schedule(), notify: (_level, text) => console.info('[酒馆指令]', text) });
  const tavernHost = createTavernHost({ native, snapshot, refresh: refreshViews, publish,
    parseTemplate: async (text, context) => (await evaluate({ operation: 'template', snapshot: snapshot(native.db().characters.find(item => item.chaId === context.characterId) ?? character()), method: 'evalTemplate', args: [text] })).value,
    executeSlash: slash });
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
      await dispatchToFrames(chat.id, 'generation_started', [operation, {}, false]);
      await dispatchToFrames(chat.id, 'GENERATION_AFTER_COMMANDS', [operation, {}, false]);
      await prepareInput(target, signal);
      const outputMessage = arg.continue && chat.message.at(-1)?.role === 'char'
        ? { ...clone(chat.message.at(-1)), time: Date.now() }
        : { role: 'char', saying: target.chaId, chatId: crypto.randomUUID(), time: Date.now() };
      let current;
      const result = await generateTransaction({ id: `${target.chaId}/${chat.id}`, signal,
        preview: !!(arg.preview || arg.previewPrompt), read: () => snapshot(target, operation),
        build: async input => {
          current = input;
          const prompt = await evaluate({ operation: 'prompt', snapshot: await resolveInjections(clone(input)) }, signal);
          const [event] = await dispatchToFrames(chat.id, 'chat_completion_prompt_ready', [{ chat: prompt.messages, dryRun: !!(arg.preview || arg.previewPrompt) }]);
          prompt.messages = event.chat;
          return prompt;
        },
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
          state: stateOf(prepared), lineage: prepared.lineage, templateProcessed: true } };
          if (operation === 'continue' && chat.message.at(-1)?.role === 'char') chat.message[chat.message.length - 1] = message;
          else chat.message.push(message);
          persist(chat, prepared); refreshViews(chat.id);
          publish(chat.id, [...prepared.events ?? [], { name: 'message_received', args: [chat.message.length - 1 + Number(!chat.stCompatibility?.greetingMaterialized), 'normal'] }]);
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
    } finally {
      controllers.delete(controller);
      if ([...generations.values()].some(job => !job.config.should_silence)) frontendOwnsBusy = true;
      else native.busy(false);
      publish(chat.id, [{ name: signal.aborted ? 'generation_stopped' : 'generation_ended', args: [chat.message.length] }]); schedule();
    }
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
    if (method === 'eventDone') {
      const pending = eventAcks.get(args[0]);
      if (pending?.channel === channel) { eventAcks.delete(args[0]); args[2] ? pending.reject(args[2]) : pending.resolve(args[1]); }
      return;
    }
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
            if (change.scope === 'global') native.db().stCompatibilityHost.variables = change.after;
            else chat.stCompatibility.state.variables = change.after;
          } else if (!handled && change.scope.startsWith('script:')) {
            target.stCompatibility.scriptVariables ??= {}; target.stCompatibility.scriptVariables[change.scope.slice(7)] = change.after;
          } else if (!handled && change.scope.startsWith('extension:')) {
            target.stCompatibility.extensionVariables ??= {}; target.stCompatibility.extensionVariables[change.scope.slice(10)] = change.after;
          } else if (!handled && change.scope === 'preset') {
            const preset = native.db().stCompatibilityAssets?.[target.stCompatibility.presetHash]?.data;
            if (preset) { preset.extensions ??= {}; preset.extensions.tavern_helper ??= {}; preset.extensions.tavern_helper.variables = change.after; }
            else native.db().stCompatibilityHost.defaultPresetVariables = change.after;
          } else if (!handled) target.stCompatibility[change.scope] = change.after;
        } else if (change.kind === 'message') applyFrontendMessageCommit(chat, { ...change,
          before: entry.view.messages.find(m => String(m.storage_id ?? m.message_id) === String(change.messageId ?? 0)) });
        else if (change.kind === 'storage') applyFrontendStorageCommit(target.stCompatibility, change);
        else if (change.kind === 'metadata') { chat.stCompatibility ??= {}; chat.stCompatibility.state ??= {}; chat.stCompatibility.state.metadata = change.after; }
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
      } else if (method === 'tavern') {
        const payload = args[0] ?? {};
        const context = { ...payload.context, characterId: entry.characterId, chatId: entry.chatId, frameChannel: channel };
        if (payload.method === 'getModelList') reply.result = await call('modelList', payload.args?.[0] ?? {});
        else reply.result = await tavernHost.call(payload.method, payload.args, context);
      } else if (method === 'template') {
        const payload = args[0] ?? {};
        const result = await evaluate({ operation: 'template', snapshot: snapshot(target), method: payload.method, args: payload.args });
        persist(chat, result); reply.result = result.value; refreshViews(chat.id);
      } else if (method === 'templateEffects') {
        if (entry.revision !== revision(chat)) throw new Error('模板执行期间聊天已改变，请重试');
        persist(chat, args[0]); refreshViews(chat.id); reply.result = true;
      } else if (method === 'generate' || method === 'generateRaw') {
        reply.result = await frontendGenerate(method, args[0], { ...entry, frameChannel: channel });
      } else if (method === 'stopGeneration') {
        const job = generations.get(args[0]?.generation_id);
        if (job) job.controller.abort(); reply.result = !!job;
      } else if (method === 'diagnostic') { console.warn('[角色前端]', ...args); reply.result = true; }
      else throw new Error(`尚未支持前端接口：${method}`);
    } catch (error) { reply.error = String(error.message); reply.errorName = error.name; }
    entry.node.contentWindow?.postMessage(clone(reply), '*');
  };
  const cleanupMount = mount => {
    for (const part of mount.parts) { frames.delete(part.id); for (const job of generations.values()) if (job.context.frameChannel === part.id) job.controller.abort(); }
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
      if (!mount.body.isConnected || !mount.container.isConnected || character()?.chaId !== target.chaId || target.chats[target.chatPage].id !== input.chat.id
        || revision(chat) !== revision(input.chat) || assetRevision(target.stCompatibility) !== input.assetRevision) return;
      if (result.templateProcessed) {
        if (index < 0) { chat.stCompatibility ??= {}; chat.stCompatibility.greetingMessage = result.permanentText; chat.stCompatibility.greetingTemplateProcessed = true; }
        else { message.data = result.permanentText; message.stCompatibility ??= {}; Object.assign(message.stCompatibility, { templateProcessed: true, state: stateOf(result), lineage: result.lineage }); }
        applyTemplateEffects(chat, result);
      }
      if (result.templateRendered) {
        if (index < 0) { chat.stCompatibility ??= {}; chat.stCompatibility.greetingTemplateRendered = true; }
        else { message.stCompatibility ??= {}; message.stCompatibility.templateRendered = true; }
        chat.stCompatibility ??= {}; chat.stCompatibility.state ??= {};
        chat.stCompatibility.state.template = result.templateState;
        chat.stCompatibility.state.metadata = result.metadata;
        native.db().stCompatibilityHost.variables = result.globals;
        applyTemplateEffects(chat, result);
      }
      const next = [];
      for (const segment of result.text.split(/(```(?:html)?\s*\n[\s\S]*?```)/gi)) {
        if (!segment.trim()) continue;
        if (/^```/i.test(segment) && /<(?:html|script|!doctype)\b/i.test(segment)) {
          const html = segment.replace(/^```(?:html)?\s*\n/i, '').replace(/```$/, '');
          const view = { ...frameView(input, result, index), tavern: tavernHost.call('getFrontendState', [], { characterId: target.chaId, chatId: chat.id }).tavern, characterId: target.chaId },
            identity = JSON.stringify([target.chaId, chat.id, message?.chatId ?? index, message?.stCompatibility?.swipes?.current ?? chat.fmIndex]);
          const part = framePart(html, view, identity, mount.parts[next.length], globalThis.__stCompatibilityFrameLibraries);
          let entry = frames.get(part.id);
          if (!entry) {
            const node = document.createElement('iframe'); node.title = '角色状态栏'; node.setAttribute('sandbox', 'allow-scripts allow-same-origin');
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
      publish(chat.id, [{ name: message?.role === 'user' ? 'user_message_rendered' : 'character_message_rendered', args: [index + Number(!chat.stCompatibility?.greetingMaterialized)] }]);
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
  const syncScripts = () => {
    const target = character(), chat = target.chats[target.chatPage];
    const context = { characterId: target.chaId, chatId: chat.id };
    const frontend = tavernHost.call('getFrontendState', [], context);
    const flatten = trees => trees.flatMap(tree => tree.type === 'folder' ? tree.enabled ? flatten(tree.scripts ?? []) : [] : tree.enabled ? [tree] : []);
    const scripts = Object.entries(frontend.tavern.scriptTrees ?? {}).flatMap(([scope, trees]) => flatten(trees).map(script => ({ ...script, scope })));
    const desired = new Set();
    for (const script of scripts) {
      const key = `${script.scope}/${script.scope === 'global' ? '' : target.chaId}/${script.id}`; desired.add(key);
      const before = scriptFrames.get(key);
      if (before?.content === script.content) {
        if (before.chatId !== chat.id || before.characterId !== target.chaId) {
          const input = snapshot(target);
          Object.assign(before, { ...context, snapshot: input, index: chat.message.length - 1, revision: revision(chat),
            view: { ...frameView(input, { variables: input.state.variables, globals: input.state.globals }, chat.message.length - 1), ...frontend,
              characterId: target.chaId, scriptId: script.id, scriptName: script.name, scriptOnly: true } });
          before.node.contentWindow?.postMessage({ channel: before.part.id, view: before.view }, '*');
          before.node.contentWindow?.postMessage({ channel: before.part.id, event: { name: 'chat_id_changed', args: [chat.id] } }, '*');
        }
        continue;
      }
      if (before) { before.node.remove(); frames.delete(before.part.id); }
      const input = snapshot(target);
      const view = { ...frameView(input, { variables: input.state.variables, globals: input.state.globals }, chat.message.length - 1),
        ...frontend, characterId: target.chaId, scriptId: script.id, scriptName: script.name, scriptOnly: true };
      const html = `<html><head></head><body><script type="module">${script.content.replace(/<\/script/gi, '<\\/script')}\n<\/script></body></html>`;
      const part = framePart(html, view, key, undefined, globalThis.__stCompatibilityFrameLibraries);
      const node = document.createElement('iframe'); node.title = script.name; node.hidden = true;
      node.setAttribute('sandbox', 'allow-scripts allow-same-origin'); node.srcdoc = part.source;
      const entry = { node, part, ...context, index: chat.message.length - 1, messageId: null, script: true,
        content: script.content, snapshot: input, view, result: { variables: input.state.variables, globals: input.state.globals }, revision: revision(chat) };
      frames.set(part.id, entry); scriptFrames.set(key, entry); document.body.append(node);
    }
    for (const [key, entry] of scriptFrames) if (!desired.has(key)) {
      publish(entry.chatId, [{ name: 'chat_id_changed', args: [chat.id] }]);
      entry.node.remove(); frames.delete(entry.part.id); scriptFrames.delete(key);
      for (const job of generations.values()) if (job.context.frameChannel === entry.part.id) job.controller.abort();
    }
  };
  const scan = () => {
    const enabled = active();
    if (!enabled) for (const controller of controllers) controller.abort();
    for (const [body, mount] of mounts) if (!body.isConnected || !enabled || mount.characterId !== character()?.chaId) { cleanupMount(mount); mounts.delete(body); }
    if (!enabled) { for (const entry of scriptFrames.values()) { entry.node.remove(); frames.delete(entry.part.id); } scriptFrames.clear(); return; }
    syncScripts();
    const target = character(), chat = target.chats[target.chatPage];
    const previous = observations.get(chat.id), currentMessages = clone(chat.message);
    if (previous) {
      const events = [], offset = Number(!chat.stCompatibility?.greetingMaterialized);
      if (currentMessages.length < previous.messages.length) events.push({ name: 'message_deleted', args: [currentMessages.length + offset] });
      for (const [index, item] of currentMessages.entries()) {
        const before = previous.messages.find(value => value.chatId && value.chatId === item.chatId) ?? previous.messages[index];
        if (!before) continue;
        const swipe = item.stCompatibility?.swipes?.current ?? 0, oldSwipe = before.stCompatibility?.swipes?.current ?? 0;
        if (swipe !== oldSwipe) events.push({ name: 'message_swiped', args: [index + offset] });
        else if (before.data !== item.data && before.chatId === item.chatId) {
          events.push({ name: 'message_edited', args: [index + offset] }, { name: 'message_updated', args: [index + offset] });
        }
      }
      if (previous.fmIndex !== chat.fmIndex) events.push({ name: 'character_first_message_selected', args: [Math.max(0, chat.fmIndex + 1)] });
      if (events.length) publish(chat.id, events);
    }
    observations.set(chat.id, { messages: currentMessages, fmIndex: chat.fmIndex });
    for (const body of document.querySelectorAll('.risu-chat[data-chat-index] .chattext:not([data-st-compatibility])')) {
      let mount = mounts.get(body);
      if (!mount) {
        const container = document.createElement('div'); container.className = body.className; container.dataset.stCompatibility = 'renderer';
        container.style.fontSize = body.style.fontSize; container.style.lineHeight = body.style.lineHeight;
        mount = { body, container, display: body.style.display, parts: [], key: null, pending: false, characterId: character().chaId };
        body.style.display = 'none'; body.after(container); mounts.set(body, mount);
      }
      void render(mount);
    }
  };
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; scan(); }); } }
  const observer = new MutationObserver(schedule); observer.observe(document.body, { childList: true, subtree: true });
  const interval = setInterval(scan, 500);
  const stopNativeGeneration = event => {
    if (active() && event.target.closest?.('button[aria-labelledby="cancel"]')) for (const controller of controllers) controller.abort(new DOMException('生成已取消', 'AbortError'));
  };
  document.addEventListener('click', stopNativeGeneration, true);
  window.addEventListener('message', pluginMessage); window.addEventListener('message', frameMessage);
  const runtime = globalThis.__stCompatibilityRuntime = { active, send, snapshot, command,
    tavern: tavernHost,
    generate: (method, config) => frontendGenerate(method, config, { characterId: character().chaId, chatId: character().chats[character().chatPage].id }),
    generationProgress(id, progress) {
      const job = generations.get(id), entry = job && frames.get(job.context.frameChannel); if (!entry) return;
      for (const [field, full, delta] of [['content', iframeEvents.STREAM_TOKEN_RECEIVED_FULLY, iframeEvents.STREAM_TOKEN_RECEIVED_INCREMENTALLY], ['reasoning', iframeEvents.REASONING_TOKEN_RECEIVED_FULLY, iframeEvents.REASONING_TOKEN_RECEIVED_INCREMENTALLY]]) {
        const value = progress[field] ?? '', previous = job[field] ?? ''; if (!value || value === previous) continue;
        job[field] = value;
        entry.node.contentWindow?.postMessage({ channel: entry.part.id, event: { name: full, args: [value, id] } }, '*');
        entry.node.contentWindow?.postMessage({ channel: entry.part.id, event: { name: delta, args: [value.startsWith(previous) ? value.slice(previous.length) : value, id] } }, '*');
      }
    },
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
      for (const job of generations.values()) job.controller.abort();
      for (const entry of frames.values()) if (entry.script) entry.node.remove();
      observer.disconnect(); clearInterval(interval);
      document.removeEventListener('click', stopNativeGeneration, true);
      window.removeEventListener('message', pluginMessage); window.removeEventListener('message', frameMessage);
      for (const mount of mounts.values()) cleanupMount(mount);
      for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('运行层已结束')); }
      waiting.clear(); native.restore(); delete globalThis.__stCompatibilityRuntime;
    },
  };
  schedule();
  return { installed: true };
}
