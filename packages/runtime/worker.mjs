import { parentPort } from 'node:worker_threads';
import { evaluateCardOperation } from '../core/operation.mjs';

// 卡片计算不承担资源下载或模型请求。
globalThis.fetch = async () => { throw new Error('卡片计算 Worker 不提供网络调用'); };
const pending = new Map();
let serial = 0;
const count = payload => new Promise((resolve, reject) => {
  const id = ++serial;
  pending.set(id, { resolve, reject });
  parentPort.postMessage({ type: 'tokenize', id, ...payload });
});
parentPort.on('message', async message => {
  if (message.type === 'tokens') {
    const request = pending.get(message.id);
    pending.delete(message.id);
    message.error ? request?.reject(new Error(message.error)) : request?.resolve(message.count);
  } else if (message.type === 'run') {
    try {
      const result = await evaluateCardOperation(message, {
        countTokens: text => count({ text }), countMessages: messages => count({ messages }),
      });
      parentPort.postMessage({ type: 'result', result });
    } catch (error) { parentPort.postMessage({ type: 'error', error: String(error?.stack ?? error), events: error.events ?? [] }); }
  }
});
