const text = value => value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const truthy = value => !['', 'false', 'off', 'no', '0', 'null', 'undefined'].includes(text(value).trim().toLowerCase());
const unquote = value => {
  value = value.trim();
  if ((value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
  return value.replace(/\\([\\|"'])/g, '$1');
};

/** 管道只在引号、JSON 和闭包外分割；变量替换发生在解析后。 */
export function splitSlashPipeline(source) {
  const result = [];
  let start = 0, quote = '', closure = 0, depth = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], pair = source.slice(index, index + 2);
    if (char === '\\') { index++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (pair === '{:') { closure++; index++; continue; }
    if (pair === ':}' && closure) { closure--; index++; continue; }
    if (closure) continue;
    if (char === '[' || char === '{') depth++;
    if (char === ']' || char === '}') depth--;
    if (char === '|' && depth === 0) { result.push(source.slice(start, index).trim()); start = index + 1; }
  }
  if (quote || closure || depth) throw new SyntaxError('Slash 指令中的引号、JSON 或闭包未闭合');
  result.push(source.slice(start).trim());
  return result.filter(Boolean);
}

function parseCommand(source) {
  const match = source.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) throw new SyntaxError(`Slash 指令必须以 / 开头：${source}`);
  const options = {};
  let rest = match[2] ?? '';
  while (true) {
    const key = rest.match(/^([\w-]+)=/);
    if (!key) break;
    rest = rest.slice(key[0].length);
    let end = 0, quote = '', depth = 0;
    for (; end < rest.length; end++) {
      const char = rest[end];
      if (char === '\\') { end++; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') depth--;
      if (/\s/.test(char) && depth === 0) break;
    }
    options[key[1]] = unquote(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  return { name: match[1].toLowerCase(), options, value: unquote(rest) };
}

/** 复用宿主资源和变量提交；生成与界面行为由当前客户端接线。 */
export function createSlashExecutor({ call, readVariables, replaceVariables, generate, substitute = value => value,
  setInput, reload, notify = () => {} }) {
  const requireCallback = (callback, name) => {
    if (typeof callback !== 'function') throw new Error(`Slash ${name}接口尚未接通`);
    return callback;
  };
  return async function execute(command, context = {}) {
    const local = {};
    const resource = (method, args = []) => call(method, args, context);
    const read = scope => requireCallback(readVariables, '变量读取')(scope, context);
    const write = (scope, value) => requireCallback(replaceVariables, '变量写入')(value, scope, context);
    const expand = async (source, pipe) => {
      const matches = [...source.matchAll(/{{(pipe|timesIndex|var::([^}]+)|getvar::([^}]+)|getglobalvar::([^}]+))}}/gi)];
      const values = await Promise.all(matches.map(async match => match[1].toLowerCase() === 'pipe' ? pipe
        : match[1].toLowerCase() === 'timesindex' ? local.timesIndex ?? ''
          : match[2] ? local[match[2]] ?? '' : (await read(match[4] ? 'global' : 'chat'))[match[4] ?? match[3]] ?? ''));
      let index = 0;
      return substitute(source.replace(/{{(pipe|timesIndex|var::([^}]+)|getvar::([^}]+)|getglobalvar::([^}]+))}}/gi, () => text(values[index++])), context);
    };
    const variable = async (name, options, value) => {
      const scope = name.includes('global') ? 'global' : 'chat';
      const action = name.replace('global', '').replace('var', '');
      const key = options.key ?? (['set', 'add'].includes(action) ? '' : value);
      if (!key) throw new Error('变量名称不能为空');
      const values = structuredClone(await read(scope));
      let before = values[key];
      if (options.index !== undefined) {
        if (typeof before === 'string') { try { before = JSON.parse(before); } catch { before = null; } }
        before ??= Number.isNaN(Number(options.index)) ? {} : [];
      }
      const current = options.index === undefined ? before : before[options.index];
      if (action === 'get') return current ?? '';
      if (action === 'flush') { delete values[key]; await write(scope, values); return ''; }
      let result = value;
      if (action === 'inc' || action === 'dec') result = (Number(current) || 0) + (action === 'inc' ? 1 : -1);
      if (action === 'add') {
        let array = current;
        if (typeof array === 'string') { try { array = JSON.parse(array); } catch {} }
        result = Array.isArray(array) ? JSON.stringify([...array, value])
          : Number.isNaN(Number(current ?? 0)) || Number.isNaN(Number(value)) ? text(current) + value : Number(current ?? 0) + Number(value);
      }
      if (options.index === undefined) values[key] = result;
      else {
        before[options.index] = options.as === 'number' ? Number(result) : options.as === 'boolean' ? truthy(result)
          : options.as === 'object' || options.as === 'list' ? JSON.parse(result) : result;
        values[key] = JSON.stringify(before);
      }
      await write(scope, values);
      return result;
    };
    const compare = async options => {
      const chat = await read('chat'), global = await read('global');
      const resolve = value => local[value] ?? chat[value] ?? global[value] ?? value;
      const left = resolve(options.left), right = resolve(options.right);
      switch (options.rule ?? 'eq') {
        case 'eq': return text(left) === text(right);
        case 'neq': return text(left) !== text(right);
        case 'gt': return Number(left) > Number(right);
        case 'gte': return Number(left) >= Number(right);
        case 'lt': return Number(left) < Number(right);
        case 'lte': return Number(left) <= Number(right);
        case 'in': return text(left).includes(text(right));
        case 'nin': return !text(left).includes(text(right));
        case 'not': return !truthy(left);
        default: throw new Error(`Slash 比较规则不存在：${options.rule}`);
      }
    };
    const run = async (source, initial = '') => {
      let pipe = initial;
      source = source.trim();
      if (source.startsWith('{:') && source.endsWith(':}')) source = source.slice(2, -2);
      for (const segment of splitSlashPipeline(source)) {
        if (segment.startsWith('//')) continue;
        const parsed = parseCommand(segment), { name } = parsed;
        const options = Object.fromEntries(await Promise.all(Object.entries(parsed.options).map(async ([key, value]) => [key,
          value.startsWith('{:') ? value : await expand(value, pipe)])));
        const value = ['if', 'while', 'times'].includes(name) ? parsed.value : await expand(parsed.value || pipe, pipe);
        let result = pipe;
        if (/^(set|get|add|inc|dec|flush)(global)?var$/.test(name)) result = await variable(name, options, value);
        else if (name === 'pass' || name === 'return') result = value;
        else if (name === 'echo') { await notify(value, options); result = value; }
        else if (name === 'let' || name === 'var') {
          const key = options.key ?? value.split(/\s+/, 1)[0];
          const assigned = options.key ? value : value.slice(key.length).trim();
          if (assigned || name === 'let') local[key] = assigned;
          result = local[key] ?? '';
        } else if (name === 'if') result = await run(await compare(options) ? value : options.else ?? '/pass', pipe);
        else if (name === 'while' || name === 'times') {
          const match = name === 'times' ? value.match(/^(\d+)\s+([\s\S]*)$/) : null;
          if (name === 'times' && !match) throw new SyntaxError('/times 需要次数与闭包');
          const count = name === 'times' ? Number(match[1]) : Infinity;
          const limit = options.guard === 'off' ? count : Math.min(count, 100);
          for (let index = 0; index < limit && (name !== 'while' || await compare(options)); index++) {
            local.timesIndex = index; result = await run(unquote(match?.[2] ?? value), text(result));
          }
        } else if (name === 'messages' || name === 'message') {
          const messages = await resource('getChatMessages', [value || 'latest', { role: options.role,
            hide_state: options.hidden !== undefined && !truthy(options.hidden) ? 'unhidden' : 'all' }]);
          result = messages.map(message => truthy(options.names) ? `${message.name}: ${message.message}` : message.message).join('\n');
        } else if (['send', 'sys', 'sysgen', 'sendas', 'comment'].includes(name)) {
          const role = name === 'send' ? 'user' : name === 'sendas' ? 'assistant' : 'system';
          await resource('createChatMessages', [[{ role, message: name === 'sysgen' ? await requireCallback(generate, '生成')({ user_input: value }, context) : value,
            ...(options.name ? { name: options.name } : {}), ...(name === 'comment' ? { is_hidden: true } : {}) }],
          { insert_before: options.at === undefined ? 'end' : Number(options.at) }]);
          result = '';
        } else if (name === 'hide' || name === 'unhide' || name === 'del') {
          const messages = await resource('getChatMessages', [value || 'latest']);
          await resource(name === 'del' ? 'deleteChatMessages' : 'setChatMessages', [name === 'del' ? messages.map(message => message.message_id)
            : messages.map(message => ({ message_id: message.message_id, is_hidden: name === 'hide' }))]); result = '';
        } else if (name === 'gen' || name === 'genraw') result = await requireCallback(generate, '生成')({ user_input: value, raw: name === 'genraw',
          ...(options.length === undefined ? {} : { max_tokens: Number(options.length) }) }, context);
        else if (name === 'setinput') { await requireCallback(setInput, '输入框')(value, context); result = value; }
        else if (name === 'reload-page') { await requireCallback(reload, '重载')(context); result = ''; }
        else if (name === 'preset') {
          if (value && !await resource('loadPreset', [value])) throw new Error(`预设不存在：${value}`);
          result = await resource('getLoadedPresetName');
        } else if (name === 'world') {
          if (value) {
            const names = options.name ? JSON.parse(options.name) : [value];
            const before = await resource('getGlobalWorldbookNames');
            await resource('rebindGlobalWorldbooks', [options.state === 'off' ? before.filter(name => !names.includes(name))
              : options.state === 'toggle' ? [...before.filter(name => !names.includes(name)), ...names.filter(name => !before.includes(name))]
                : [...new Set([...before, ...names])]]);
          }
          result = await resource('getGlobalWorldbookNames');
        } else if (name === 'inject') {
          if (!options.id) throw new Error('/inject 需要 id');
          await resource('injectPrompts', [[{ id: options.id, content: value, role: options.role ?? 'system',
            position: options.position === 'none' ? 'none' : 'in_chat', depth: Number(options.depth ?? 0), should_scan: truthy(options.scan) }], { once: truthy(options.ephemeral) }]); result = '';
        } else if (name === 'flushinject') { await resource('uninjectPrompts', [[options.id ?? value]]); result = ''; }
        else if (name === 'getcharbook') result = (await resource('getCharWorldbookNames', [options.name ?? 'current'])).primary ?? '';
        else if (name === 'getchatbook') result = await resource('getChatWorldbookName', ['current']) ?? '';
        else if (name === 'getglobalbooks') result = await resource('getGlobalWorldbookNames');
        else if (name === 'findentry') {
          const entries = await resource('getLorebookEntries', [options.file ?? options.book]);
          result = entries.find(entry => text(entry[options.field ?? 'keys']).includes(value))?.uid ?? '';
        } else if (name === 'getentryfield' || name === 'setentryfield') {
          const book = options.file ?? options.book, uid = Number(options.uid);
          const entries = await resource('getLorebookEntries', [book]);
          const entry = entries.find(entry => entry.uid === uid);
          if (!entry) throw new Error(`世界书条目不存在：${uid}`);
          if (name === 'getentryfield') result = entry[options.field ?? 'content'];
          else {
            const field = ({ key: 'keys', filter: 'filters' })[options.field] ?? options.field ?? 'content';
            const previous = entry[field];
            const converted = Array.isArray(previous) ? JSON.parse(value) : typeof previous === 'boolean' ? truthy(value)
              : typeof previous === 'number' ? Number(value) : value;
            await resource('setLorebookEntries', [book, [{ uid, [field]: converted }]]); result = value;
          }
        } else if (name === 'createentry') {
          const created = await resource('createLorebookEntries', [options.file ?? options.book, [{ content: value, keys: options.key ? [options.key] : [] }]]);
          result = created.new_uids[0];
        } else throw new Error(`Slash 指令尚未注册：/${name}`);
        pipe = text(result);
        if (name === 'return') break;
      }
      return pipe;
    };
    return { pipe: await run(String(command)) };
  };
}
