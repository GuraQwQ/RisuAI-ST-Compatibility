import { createFrontendApi } from '../core/frontend-api.mjs';
import { createFrontendResources, normalizeScriptTrees } from '../core/frontend-resources.mjs';
import { iframeEvents, tavernEvents } from '../core/frontend-events.mjs';

export function framePart(html, view, identity, previous, libraries = '') {
  if (previous?.rawHtml === html && previous.identity === identity) return previous;
  const id = crypto.randomUUID();
  return { id, rawHtml: html, identity, source: frameDocument(html, id, view, libraries) };
}

export function frameDocument(html, channel, view, libraries = '') {
  const literal = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const bootstrap = `<script>${libraries.replace(/<\/script/gi, '<\\/script')}
  (() => {
    const host = parent;
    const channel = ${literal(channel)};
    const lodash = globalThis._;
    const normalizeScriptTrees = (${normalizeScriptTrees.toString()});
    const createFrontendResources = (${createFrontendResources.toString()});
    const iframeEvents = ${literal(iframeEvents)};
    const tavernEvents = ${literal(tavernEvents)};
    let serial = 0;
    const waiting = new Map();
    const call = (method, ...args) => new Promise((resolve, reject) => {
      const requestId = ++serial;
      const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error('宿主接口超时：' + method)); }, ['generate', 'generateRaw'].includes(method) ? 1800000 : 65000);
      timer.unref?.();
      waiting.set(requestId, {resolve, reject, timer});
      host.postMessage({channel, method, args, requestId}, '*');
    });
    const environment = { ...globalThis.__stFrontendEnvironment, _: lodash,
      globals: host.__stFrontendGlobals ??= { values: new Map(), owners: new Map(), waiting: new Map() },
      generations: host.__stFrontendGenerations ??= new Map(),
      injections: host.__stFrontendInjections ??= new Map(),
      exposeGlobal: (name, value) => { window[name] = value; }, reload: () => location.reload(),
      retrieveDisplayedMessage: id => globalThis.$?.(host.document.querySelector('.risu-chat[data-chat-index="' + (id - 1) + '"] .chattext')),
      formatDisplay: (text, message, api) => globalThis.__stFrontendEnvironment?.markdown(api.formatAsTavernRegexedString(text, message?.role === 'user' ? 'user_input' : 'ai_output', 'display', {depth: api.getLastMessageId() - message?.message_id})) ?? text,
      refreshOneMessage: async (id, node, api) => { const messages = api.getChatMessages(id); if (messages[0]) (node ?? api.retrieveDisplayedMessage(id))?.html(api.formatAsDisplayedMessage(messages[0].message, {message_id:id})); },
    };
    const bridge = (${createFrontendApi.toString()})(${literal({ ...view, frameChannel: channel })}, call, (type, message) => {
      host.postMessage({channel, method:'diagnostic', args:[{type,message}]}, '*');
    }, environment);
    addEventListener('message', async event => {
      if (event.source !== host || event.data?.channel !== channel) return;
      if (event.data.view || event.data.event && event.data.event.origin !== channel) {
        try {
          await bridge.receive(event.data);
          if (event.data.hostEventId) host.postMessage({channel,method:'eventDone',args:[event.data.hostEventId,event.data.event.args]}, '*');
        } catch(error) { host.postMessage({channel,method:'eventDone',args:[event.data.hostEventId,null,String(error.message)]}, '*'); }
        const storage = event.data.event?.name === 'st_local_storage_changed' && event.data.event.args?.[0];
        if (storage) window.dispatchEvent(new StorageEvent('storage', {key: storage.operation === 'clear' ? null : storage.key,
          oldValue: storage.operation === 'clear' ? null : storage.oldValue ?? null,
          newValue: storage.operation === 'set' ? storage.value : null, url: location.href}));
        return;
      }
      const pending = waiting.get(event.data.requestId);
      if (!pending) return;
      waiting.delete(event.data.requestId); clearTimeout(pending.timer);
      event.data.error ? pending.reject(Object.assign(new Error(event.data.error), { name: event.data.errorName ?? 'Error' })) : pending.resolve(event.data.result);
    });
    Object.defineProperty(window, 'localStorage', {value: bridge.api.localStorage});
    const api = {...bridge.api}; delete api.localStorage;
    Object.assign(window, api);
    window.addEventListener?.('error', event => host.postMessage({channel,method:'diagnostic',args:[{message:event.message}]}, '*'));
    window.addEventListener?.('unhandledrejection', event => host.postMessage({channel,method:'diagnostic',args:[{message:String(event.reason)}]}, '*'));
    window.name = bridge.api.getIframeName();
    // 卡片的父窗口 API 映射到本地适配视图；真实宿主只经 host 通信。
    Object.defineProperty(window, 'parent', {value: window, configurable: true});
    addEventListener('pagehide', () => bridge.dispose());
    addEventListener('DOMContentLoaded', () => {
      const resize = () => host.postMessage({channel, method:'resize', args:[document.body.scrollHeight + 8]}, '*');
      new ResizeObserver(resize).observe(document.body);
      resize();
      void bridge.receive({event:{name:iframeEvents.MESSAGE_IFRAME_RENDER_ENDED,args:[${literal(view.currentMessageId ?? null)}]}});
    });
  })();
  <\/script>`;
  return /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, match => match + bootstrap) : bootstrap + html;
}
