const inFlight = new Set();

/** 提交在一个同步回调内完成；异步模型返回不能覆盖后来的编辑。 */
export async function generateTransaction({ id, read, build, provider, prepare, commit, retain, signal, preview = false }) {
  if (inFlight.has(id)) return { status: 'busy' };
  inFlight.add(id);
  let response;
  let snapshot;
  let prompt;
  try {
    snapshot = read();
    const revision = JSON.stringify(snapshot);
    prompt = await build(structuredClone(snapshot));
    signal?.throwIfAborted();
    if (preview) return { status: 'preview', prompt };
    response = await provider(prompt.messages, signal);
    signal?.throwIfAborted();
    const prepared = await prepare?.({ response, prompt, snapshot });
    signal?.throwIfAborted();
    if (JSON.stringify(read()) !== revision) {
      await retain?.({ response, prompt: prompt.messages, snapshot });
      return { status: 'conflict' };
    }
    commit({ response, prompt, snapshot, prepared });
    return { status: 'committed', prompt };
  } catch (error) {
    if (response !== undefined) await retain?.({ response, prompt: prompt?.messages, snapshot, error: String(error) });
    if (signal?.aborted) return { status: 'cancelled' };
    throw error;
  } finally {
    inFlight.delete(id);
  }
}
