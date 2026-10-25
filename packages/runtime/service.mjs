import { readFile, mkdir, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { parseCard, bytesFromBase64 } from '../core/card.mjs';
import { installCardMigration } from '../core/migration.mjs';
import { attachNativeModule } from './attach.mjs';
import { evaluateInWorker } from './evaluate.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function writeAtomic(file, data) {
  const bytes = typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data, null, 2) + '\n';
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.writing';
  const handle = await open(temporary, 'w');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  if (digest(await readFile(temporary)) !== digest(bytes)) throw new Error('写入校验失败，已保留待恢复文件');
  await rename(temporary, file);
}

export async function startRuntimeService(cdp, { projectRoot = root, log = console.log } = {}) {
  const dataRoot = path.join(projectRoot, 'data/runtime');
  const controllers = new Map();
  let queue = Promise.resolve(), attaching, contextId;
  const contexts = new Map();
  cdp.on('Runtime.executionContextCreated', event => contexts.set(event.context.id, event.context));
  cdp.on('Runtime.executionContextsCleared', () => {
    contexts.clear(); contextId = undefined;
    for (const controller of controllers.values()) controller.abort();
  });
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  const browser = (expression, id = contextId) => cdp.evaluate(expression, true, id);
  const invoke = (method, payload, id) => browser(`globalThis.__stCompatibilityRuntime.${method}(${JSON.stringify(payload)})`, id);
  const migrate = async (payload, id) => {
    if (!['local', 'risu'].includes(payload.provider ?? 'local')) throw new Error('未知模型连接');
    const bytes = payload.base64 ? bytesFromBase64(payload.base64) : new TextEncoder().encode(payload.json);
    const source = await parseCard(bytes, payload.filename), hash = source.hash, card = source.card.data;
    const directory = path.join(dataRoot, 'sources', hash);
    await writeAtomic(path.join(directory, 'raw.bin'), bytes);
    await writeAtomic(path.join(directory, 'report.json'), source.report);
    const list = () => browser(`JSON.parse(JSON.stringify(__stCompatibilityNative.db().characters.filter(c=>c.stCompatibility?.hash===${JSON.stringify(hash)})))`, id);
    let characters = await list();
    const record = path.join(dataRoot, 'migrations', hash + '.json');
    return installCardMigration({ source,
      storage: { get: async () => {
        try { return JSON.parse(await readFile(record, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      }, set: (_key, value) => writeAtomic(record, value) },
      list: () => characters,
      create: async () => {
        const saveAsset = (data, checksum, filename) => browser(`__stCompatibilityNative.saveAsset(new Uint8Array(${JSON.stringify(Array.from(data))}),${JSON.stringify(checksum)},${JSON.stringify(path.basename(filename))})`, id);
        const resources = {};
        for (const resource of source.resources) resources[resource.name] = await saveAsset(resource.bytes, resource.hash, resource.name);
        const image = source.format === 'png' ? await saveAsset(bytes, hash, source.filename) : undefined;
        return invoke('createCharacter', { name: card.name, desc: card.description ?? '', firstMessage: card.first_mes,
          personality: card.personality ?? '', scenario: card.scenario ?? '', creatorNotes: card.creator_notes ?? '',
          tags: card.tags ?? [], creator: card.creator ?? '', alternateGreetings: card.alternate_greetings ?? [], image,
          stCompatibility: { enabled: true, hash, card: source.card, resources, provider: payload.provider ?? 'local',
            localResponse: payload.localResponse ?? '本地固定回复。<StatusPlaceHolderImpl/>' } }, id);
      },
      publish: async value => { await invoke('publishCharacter', value, id); characters = await list(); },
      activate: characterId => invoke('selectCharacter', characterId, id),
    });
  };
  const handle = async (request, id, signal) => {
    if (request.method === 'preview') {
      const bytes = request.payload.base64 ? bytesFromBase64(request.payload.base64) : new TextEncoder().encode(request.payload.json);
      return (await parseCard(bytes, request.payload.filename)).report;
    }
    if (request.method === 'import') return migrate(request.payload, id);
    if (request.method === 'retain') {
      const identity = digest(JSON.stringify([request.payload.characterId, request.payload.chatId]));
      await writeAtomic(path.join(dataRoot, 'conflicts', identity, `${Date.now()}-${randomUUID()}.json`), request.payload);
      return true;
    }
    if (request.method !== 'evaluate') throw new Error(`未知运行层请求：${request.method}`);
    const run = () => evaluateInWorker(request.payload, payload => {
      if (request.payload.snapshot.provider !== 'local') return invoke('count', payload, id);
      if (payload.messages) return (Array.isArray(payload.messages) ? payload.messages : [payload.messages])
        .reduce((sum, message) => sum + Array.from(String(message.content ?? '')).length + 4 + (message.name ? Array.from(message.name).length : 0), 0);
      return Array.from(String(payload.text ?? '')).length;
    }, signal);
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  };
  cdp.on('Runtime.bindingCalled', event => {
    if (event.name !== '__stCompatibilityCall' || event.executionContextId !== contextId) return;
    let request;
    try { request = JSON.parse(event.payload); } catch { return; }
    const key = `${event.executionContextId}/${request.id}`;
    if (request.method === 'cancel') { controllers.get(`${event.executionContextId}/${request.payload.id}`)?.abort(); return; }
    const controller = new AbortController(); controllers.set(key, controller);
    handle(request, event.executionContextId, controller.signal).then(result => ({ result }), error => ({ error: String(error.message) }))
      .then(reply => browser(`globalThis.__stCompatibilityRuntime?.resolve(${request.id},${JSON.stringify(reply.result ?? null)},${JSON.stringify(reply.error ?? null)})`, event.executionContextId))
      .catch(error => log(`运行层回传已中止：${error.message}`)).finally(() => controllers.delete(key));
  });
  const attach = async () => {
    if (attaching) return attaching;
    attaching = (async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await cdp.evaluate("typeof __debugV3Plugin==='function'&&typeof __pluginApis__==='object'&&Array.isArray(__pluginApis__.getDatabase().characters)").catch(() => false)) break;
        if (attempt === 99) throw new Error('客户端数据尚未就绪，可重新启动运行层重试');
        await sleep(300);
      }
      const tree = await cdp.send('Page.getFrameTree');
      contextId = [...contexts.values()].find(c => c.auxData?.isDefault && c.auxData.frameId === tree.frameTree.frame.id)?.id;
      if (!contextId) throw new Error('未找到客户端主页面上下文');
      await cdp.send('Runtime.addBinding', { name: '__stCompatibilityCall', executionContextId: contextId });
      await browser('if(globalThis.__stCompatibilityRuntime)__stCompatibilityRuntime.dispose();else globalThis.__stCompatibilityNative?.restore()');
      const hooks = await attachNativeModule(cdp);
      const bundle = await readFile(path.join(projectRoot, 'dist/runtime-page.js'), 'utf8');
      const libraries = await readFile(path.join(projectRoot, 'dist/runtime-frame.js'), 'utf8');
      await browser(`globalThis.__stCompatibilityFrameLibraries=${JSON.stringify(libraries)};\n` + bundle + '\nSTCompatibilityPage.startRuntimePage()');
      const script = await readFile(path.join(projectRoot, 'packages/plugin/st-compatibility.js'), 'utf8');
      const before = await browser("JSON.parse(JSON.stringify({plugin:__stCompatibilityNative.db().plugins.filter(p=>p.name==='risu-st-compatibility'),characterOrder:__stCompatibilityNative.db().characterOrder}))");
      const backup = JSON.stringify(before, null, 2) + '\n';
      await writeAtomic(path.join(dataRoot, 'backups', digest(backup) + '.json'), backup);
      const installed = await invoke('installPlugin', script);
      if (installed.reload) {
        await sleep(3000);
        await cdp.send('Page.reload');
        return { reloading: true };
      }
      log('酒馆运行层已连接原客户端和原生聊天界面');
      return hooks;
    })().finally(() => { attaching = null; });
    return attaching;
  };
  cdp.on('Page.loadEventFired', () => { void attach().catch(error => log(`运行层接入失败：${error.message}`)); });
  cdp.on('close', () => { for (const controller of controllers.values()) controller.abort(); });
  const result = await attach();
  return { result, attach, async dispose() {
    for (const controller of controllers.values()) controller.abort();
    await browser('globalThis.__stCompatibilityRuntime?.dispose()').catch(() => {});
  } };
}
