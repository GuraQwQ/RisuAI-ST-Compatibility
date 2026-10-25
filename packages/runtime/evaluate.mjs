import { Worker } from 'node:worker_threads';

export function evaluateInWorker(message, count, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), { execArgv: [] });
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const cancel = () => finish(signal.reason ?? new Error('已取消'));
    const timer = setTimeout(() => finish(new Error('卡片求值超时，原始消息已保留')), 60000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.on('error', error => finish(error));
    worker.on('exit', code => { if (!finished) finish(new Error(`卡片求值进程已结束：${code}`)); });
    worker.on('message', async response => {
      if (finished) return;
      if (response.type === 'tokenize') {
        try {
          const result = await count(response);
          if (!finished) worker.postMessage({ type: 'tokens', id: response.id, count: result });
        } catch (error) { if (!finished) worker.postMessage({ type: 'tokens', id: response.id, error: String(error) }); }
      } else if (response.type === 'error') finish(new Error(response.error));
      else if (response.type === 'result') finish(null, response.result);
    });
    worker.postMessage({ type: 'run', ...message });
  });
}
