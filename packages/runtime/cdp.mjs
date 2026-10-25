import { EventEmitter } from 'node:events';

export class CdpConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.serial = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      } else this.emit(message.method, message.params);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer); pending.reject(new Error('客户端连接已关闭'));
      }
      this.pending.clear(); this.emit('close');
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('无法连接客户端 WebView')), { once: true });
    });
    return new CdpConnection(socket);
  }
  send(method, params = {}) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`客户端接口超时：${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression, awaitPromise = true, contextId) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, contextId: contextId ?? undefined });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  }
  close() { this.socket.close(); }
}
