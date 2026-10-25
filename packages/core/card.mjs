import { unzipSync, unzlibSync } from 'fflate';

const decoder = new TextDecoder('utf-8', { fatal: true });
export function cardScripts(data) {
  let helper = data.extensions?.tavern_helper;
  if (Array.isArray(helper) && helper.every(item => Array.isArray(item) && typeof item[0] === 'string')) helper = Object.fromEntries(helper);
  const scripts = [...(data.extensions?.TavernHelper_scripts ?? []), ...(Array.isArray(helper) ? helper : helper?.scripts ?? [])];
  const flat = [];
  const walk = items => {
    for (const item of items) {
      const script = item.value ?? item;
      if (script.type === 'folder' || script.scripts) walk(script.scripts ?? []);
      else if (typeof script.content === 'string') flat.push(script);
    }
  };
  walk(scripts);
  return [...new Map(flat.map(script => [script.id ?? script.content, script])).values()];
}
export function bytesFromBase64(value) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
export function base64FromBytes(value) {
  let output = '';
  for (let start = 0; start < value.length; start += 32768) output += String.fromCharCode(...value.subarray(start, start + 32768));
  return btoa(output);
}
export async function byteHash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function normalize(raw) {
  const source = raw.data ?? raw;
  if (!source || typeof source.name !== 'string' || typeof source.first_mes !== 'string') throw new Error('角色卡缺少 name 或 first_mes');
  if (source.character_book && !Array.isArray(source.character_book.entries)) throw new Error('世界书 entries 必须是数组');
  return raw.data ? raw : { spec: 'chara_card_v2', spec_version: '2.0', data: { ...source,
    creator_notes: source.creator_notes ?? source.creatorcomment ?? '', extensions: source.extensions ?? {} } };
}
function pngCard(bytes) {
  if (bytes.length < 20) throw new Error('PNG 数据不完整');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = {};
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    const end = offset + size + 12;
    if (end > bytes.length) throw new Error('PNG 区块被截断');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (['tEXt', 'zTXt'].includes(type)) {
      const chunk = bytes.subarray(offset + 8, offset + 8 + size);
      const separator = chunk.indexOf(0);
      if (separator < 0) throw new Error('PNG 文本区块缺少分隔符');
      const key = decoder.decode(chunk.subarray(0, separator));
      if (key === 'chara' || key === 'ccv3') {
        const text = type === 'zTXt' ? unzlibSync(chunk.subarray(separator + 2)) : chunk.subarray(separator + 1);
        values[key] = JSON.parse(decoder.decode(bytesFromBase64(decoder.decode(text))));
      }
    }
    offset = end;
    if (type === 'IEND') break;
  }
  if (!values.ccv3 && !values.chara) throw new Error('PNG 没有角色卡数据');
  return values.ccv3 ?? values.chara;
}

export async function parseCard(bytes, filename = 'card.json') {
  let raw;
  let format = 'json';
  const resources = [];
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    raw = pngCard(bytes); format = 'png';
  } else if (bytes[0] === 80 && bytes[1] === 75) {
    const files = unzipSync(bytes);
    const cardPath = Object.keys(files).find(name => name === 'card.json');
    if (!cardPath) throw new Error('CHARX 缺少 card.json');
    for (const [name, value] of Object.entries(files)) {
      if (name.startsWith('/') || name.split(/[\\/]/).includes('..')) throw new Error('CHARX 包含越界路径');
      if (name !== cardPath && !name.endsWith('/')) resources.push({ name, bytes: value, hash: await byteHash(value) });
    }
    raw = JSON.parse(decoder.decode(files[cardPath])); format = 'charx';
  } else raw = JSON.parse(decoder.decode(bytes).replace(/^\uFEFF/, ''));
  const card = normalize(raw);
  const hash = await byteHash(bytes);
  const data = card.data;
  const scripts = cardScripts(data);
  const dependencies = [...new Map(scripts.map(item => {
    const script = item.value ?? item;
    return [script.id ?? script.content, { name: script.name, enabled: script.enabled !== false,
      urls: [...(script.content ?? '').matchAll(/https?:\/\/[^\s'"`)]+/g)].map(match => match[0]), script: script.content }];
  })).values()];
  return { card, hash, format, filename, resources, dependencies,
    report: { name: data.name, format, hash, worldEntries: data.character_book?.entries.length ?? 0,
      regexScripts: data.extensions?.regex_scripts?.length ?? 0, resources: resources.length,
      scripts: dependencies.map(({ script, ...item }) => item),
      fields: { display: ['name', 'description', 'personality', 'scenario', 'first_mes', 'alternate_greetings', 'tags', 'creator', 'creator_notes'],
        runtime: ['character_book', 'extensions.regex_scripts', 'extensions.depth_prompt', 'extensions.tavern_helper', 'extensions.TavernHelper_scripts'],
        preserved: Object.keys(data) } } };
}
