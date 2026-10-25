import { parse } from 'acorn';

const key = node => node?.name ?? node?.value;
const text = node => node?.type === 'TemplateLiteral' && !node.expressions.length
  ? node.quasis[0].value.cooked : node?.type === 'Literal' ? node.value : undefined;

export function inspectNativeModule(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const nodes = [], parents = new WeakMap(), stack = [ast];
  while (stack.length) {
    const node = stack.pop();
    nodes.push(node);
    for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && typeof child.type === 'string') {
        parents.set(child, node); stack.push(child);
      }
    }
  }
  const within = (node, parent) => node.start >= parent.start && node.end <= parent.end;
  const one = (items, label) => {
    const unique = [...new Set(items)];
    if (unique.length !== 1) throw new Error(`原生接口识别失败：${label}，匹配 ${unique.length} 项`);
    return unique[0];
  };
  const owner = node => {
    while (node && node.type !== 'FunctionDeclaration') node = parents.get(node);
    return node;
  };
  const properties = nodes.filter(n => n.type === 'Property');
  const property = name => one(properties.filter(p => key(p.key) === name && p.value.async), name);
  const functions = ast.body.filter(n => n.type === 'FunctionDeclaration');
  const calls = nodes.filter(n => n.type === 'CallExpression');
  const members = nodes.filter(n => n.type === 'MemberExpression');
  const sendApi = property('sendChat');
  const send = one(calls.filter(n => within(n, sendApi) && n.callee.type === 'Identifier' &&
    n.arguments[0]?.type === 'UnaryExpression' && n.arguments[0].operator === '-' &&
    n.arguments[0].argument.value === 1 && n.arguments[1]?.type === 'ObjectExpression').map(n => n.callee.name), '生成入口');
  const database = one(members.filter(n => within(n, sendApi) && key(n.property) === 'db' && n.object.type === 'Identifier')
    .map(n => n.object.name), '数据库');
  const selectedApi = one(properties.filter(p => key(p.key) === 'getCurrentCharacterIndex'), '角色选择');
  const selection = one(calls.filter(n => within(n, selectedApi) && n.arguments.length === 1 && n.arguments[0].type === 'Identifier')
    .map(n => ({ get: n.callee.name, selected: n.arguments[0].name })), '角色选择存储');
  const busyIf = one(nodes.filter(n => n.type === 'IfStatement' && within(n, sendApi) &&
    source.slice(n.consequent.start, n.consequent.end).includes('A chat is already in progress')), '生成忙状态');
  const busy = one(calls.filter(n => within(n, busyIf.test) && n.arguments[0]?.type === 'Identifier')
    .map(n => n.arguments[0].name), '生成忙状态存储');
  const modelApi = property('runLLMModel');
  const request = one(calls.filter(n => within(n, modelApi) && n.callee.type === 'Identifier' &&
    n.arguments[0]?.type === 'ObjectExpression' && n.arguments[0].properties.some(p => key(p.key) === 'formated'))
    .map(n => n.callee.name), '模型连接');
  const tokenizerClass = one(nodes.filter(n => ['ClassDeclaration', 'ClassExpression'].includes(n.type) &&
    n.body.body.some(m => key(m.key) === 'tokenizeChats')), 'tokenizer');
  const tokenizer = tokenizerClass.id?.name ?? parents.get(tokenizerClass)?.id?.name;
  const blank = one(nodes.filter(n => n.type === 'ObjectExpression' &&
    ['chaId', 'firstMessage', 'chats', 'name'].every(k => n.properties.some(p => key(p.key) === k)) &&
    n.properties.some(p => key(p.key) === 'type' && text(p.value) === 'character')).map(n => owner(n)?.id.name), '角色创建');
  const order = one(properties.filter(p => key(p.key) === 'checkCharOrder' && p.value.type === 'Identifier')
    .map(p => p.value.name), '角色排序');
  const saveAsset = one(properties.filter(p => key(p.key) === 'saveAsset' && p.value.type === 'ArrowFunctionExpression')
    .flatMap(p => calls.filter(n => within(n, p) && n.callee.type === 'Identifier' && n.arguments.length === 1 && n.arguments[0].type === 'Identifier')
      .map(n => n.callee.name)), '资源存储');
  const renderer = one(functions.filter(fn => fn.async && calls.some(n => within(n, fn) && text(n.arguments[2]) === 'editdisplay')
    && nodes.some(n => within(n, fn) && text(n) === 'notrim')).map(fn => fn.id.name), '原生 Markdown 渲染');
  const parser = one(properties.filter(p => key(p.key) === 'risuChatParser' && p.value.type === 'Identifier' &&
    functions.some(f => f.id.name === p.value.name && members.some(m => within(m, f) && key(m.property) === 'chatID')))
    .map(p => p.value.name), '显示宏');
  const executePlugin = one(calls.filter(n => n.callee.type === 'MemberExpression' && key(n.callee.property) === 'run' &&
    n.arguments[1]?.type === 'MemberExpression' && key(n.arguments[1].property) === 'script').map(n => owner(n)?.id.name), '插件加载');
  const debug = one(nodes.filter(n => n.type === 'AssignmentExpression' && key(n.left?.property) === '__debugV3Plugin'), '插件容器入口');
  const pluginInstances = one(calls.filter(n => within(n, debug.right) && n.callee.type === 'MemberExpression' &&
    key(n.callee.property) === 'find' && n.callee.object.type === 'Identifier').map(n => n.callee.object.name), '插件容器列表');
  const sendFn = functions.find(n => n.id.name === send);
  const previewIfs = nodes.filter(n => n.type === 'IfStatement' && within(n, sendFn) &&
    members.some(m => within(m, n.test) && key(m.property) === 'previewPrompt'));
  const preview = one(nodes.filter(n => n.type === 'AssignmentExpression' && n.left.type === 'Identifier' &&
    n.right.type === 'MemberExpression' && key(n.right.property) === 'result' && previewIfs.some(p => within(n, p.consequent)))
    .map(n => n.left.name), '提示词预览');
  const result = { database, ...selection, busy, send, request, tokenizer, blank, order, saveAsset, renderer, parser, executePlugin, pluginInstances, preview };
  for (const [name, binding] of Object.entries(result)) if (!binding || !/^[$\w]+$/.test(binding)) throw new Error(`缺少原生接线：${name}`);
  for (const name of [send, request, renderer, parser]) if (!functions.some(f => f.id.name === name)) throw new Error('原生入口不是可挂接的函数声明');
  return result;
}

export function nativeCaptureExpression(b) {
  return `(() => {
    if (globalThis.__stCompatibilityNative) return { reused: true };
    const originals = { send: ${b.send}, request: ${b.request} };
    const native = globalThis.__stCompatibilityNative = {
      db: () => ${b.database}.db, selected: () => ${b.get}(${b.selected}),
      select: index => ${b.selected}.set(index), busy: value => ${b.busy}.set(value), isBusy: () => ${b.get}(${b.busy}),
      blank: ${b.blank}, order: ${b.order}, request: ${b.request}, Tokenizer: ${b.tokenizer},
      executePlugin: ${b.executePlugin}, preview: value => { ${b.preview} = value; },
      pluginWindow: name => ${b.pluginInstances}.find(plugin => plugin.name === name)?.host?.iframe?.contentWindow,
      parser: ${b.parser}, render: ${b.renderer}, saveAsset: (bytes, hash, name) => ${b.saveAsset}(bytes, hash, name),
      restore: () => { ${b.send} = originals.send; ${b.request} = originals.request; delete globalThis.__stCompatibilityNative; }
    };
    ${b.send} = async (...args) => globalThis.__stCompatibilityRuntime
      ? globalThis.__stCompatibilityRuntime.send(originals.send, ...args) : originals.send(...args);
    ${b.request} = async (...args) => {
      if (globalThis.__stCompatibilityRuntime?.isLocal()) throw new Error('当前角色使用本地固定回复，未调用模型');
      return originals.request(...args);
    };
    return { installed: true };
  })()`;
}
