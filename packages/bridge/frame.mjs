import { createFrontendApi } from '../core/frontend-api.mjs';

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
    let serial = 0;
    const waiting = new Map();
    const call = (method, ...args) => new Promise((resolve, reject) => {
      const requestId = ++serial;
      const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error('宿主接口超时：' + method)); }, 10000);
      waiting.set(requestId, {resolve, reject, timer});
      host.postMessage({channel, method, args, requestId}, '*');
    });
    const bridge = (${createFrontendApi.toString()})(${literal({ ...view, frameChannel: channel })}, call, (type, message) => {
      host.postMessage({channel, method:'diagnostic', args:[{type,message}]}, '*');
    });
    addEventListener('message', event => {
      if (event.source !== host || event.data?.channel !== channel) return;
      if (event.data.view || event.data.event && event.data.event.origin !== channel) {
        bridge.receive(event.data);
        const storage = event.data.event?.name === 'st_local_storage_changed' && event.data.event.args?.[0];
        if (storage) window.dispatchEvent(new StorageEvent('storage', {key: storage.operation === 'clear' ? null : storage.key,
          oldValue: storage.operation === 'clear' ? null : storage.oldValue ?? null,
          newValue: storage.operation === 'set' ? storage.value : null, url: location.href}));
        return;
      }
      const pending = waiting.get(event.data.requestId);
      if (!pending) return;
      waiting.delete(event.data.requestId); clearTimeout(pending.timer);
      event.data.error ? pending.reject(new Error(event.data.error)) : pending.resolve(event.data.result);
    });
    Object.defineProperty(window, 'localStorage', {value: bridge.api.localStorage});
    const api = {...bridge.api}; delete api.localStorage;
    Object.assign(window, api);
    // 卡片的父窗口 API 映射到本地适配视图；真实宿主只经 host 通信。
    Object.defineProperty(window, 'parent', {value: window, configurable: true});
    addEventListener('pagehide', () => bridge.dispose());
    addEventListener('DOMContentLoaded', () => {
      const resize = () => host.postMessage({channel, method:'resize', args:[document.body.scrollHeight + 8]}, '*');
      new ResizeObserver(resize).observe(document.body);
      resize();
    });
  })();
  <\/script>`;
  return /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, match => match + bootstrap) : bootstrap + html;
}
