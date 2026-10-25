import { build } from 'vite';
import { parse } from 'acorn';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? path.join(root, 'cache/upstream/sillytavern'));
const directory = path.join(source, 'public/scripts/macros');
const records = [];
const host = `
export * as chevrotain from 'chevrotain';
export {default as seedrandom} from 'seedrandom';
export {default as droll} from 'droll';
export {default as moment} from 'moment';
export {getStringHash,isFalseBoolean,isTrueBoolean,parseTimestamp} from '${path.join(root, 'packages/core/vendor/utils.mjs').replaceAll('\\', '/')}';
export const chat=hostContext.chat,chat_metadata=hostContext.metadata,main_api='openai',power_user={instruct:{enabled:false}};
export const getMaxContextTokens=()=>hostContext.maxContext??8192,getMaxResponseTokens=()=>hostContext.maxResponse??0;
export const getMaxPromptTokens=()=>getMaxContextTokens()-getMaxResponseTokens(),getCurrentChatId=()=>hostContext.chatId;
export const extension_prompts=hostContext.extensionPrompts??{},textgenerationwebui_banned_in_macros=[];
export const inject_ids={CUSTOM_WI_OUTLET:name=>'customWIOutlet_'+name};
export const isMobile=()=>false,formatInstructModeExamples=()=>[];
export const parseMesExamples=hostContext.parseMesExamples;
export const timestampToMoment=value=>hostContext.timestampToMoment(value);
`;
const entry = `
import {MacroEngine} from '${directory.replaceAll('\\', '/')}/engine/MacroEngine.js';
import {MacroRegistry,MacroCategory} from '${directory.replaceAll('\\', '/')}/engine/MacroRegistry.js';
${['Core', 'Variable', 'Env', 'Time', 'Chat'].map(name => `import {register${name}Macros} from '${directory.replaceAll('\\', '/')}/definitions/${name.toLowerCase()}-macros.js';`).join('\n')}
${['Core', 'Variable', 'Env', 'Time', 'Chat'].map(name => `register${name}Macros();`).join('\n')}
MacroRegistry.registerMacro('lastGenerationType',{category:MacroCategory.STATE,handler:()=>hostContext.operation??'normal'});
export {MacroEngine};
`;
const result = await build({ root, configFile: false, logLevel: 'error', plugins: [{ name: 'st-macro-host', enforce: 'pre',
  resolveId(id, importer) {
    if (/(?:^|[\\/])st-macro-entry$/.test(id)) return '\0st-macro-entry';
    if (importer?.replaceAll('\\', '/').includes('/public/scripts/macros/') && (/\/lib\.js$|\/script\.js$|\/utils\.js$|\/power-user\.js$|\/instruct-mode\.js$|\/RossAscends-mods\.js$|\/textgen-settings\.js$|\/constants\.js$/.test(id))) return '\0st-macro-host';
  },
  async load(id) {
    if (id === '\0st-macro-entry') return entry;
    if (id === '\0st-macro-host') return host;
    if (!id.replaceAll('\\', '/').startsWith(directory.replaceAll('\\', '/')) || !id.endsWith('.js')) return;
    let text = await readFile(id, 'utf8');
    records.push({ file: path.relative(source, id).replaceAll('\\', '/'), sha256: createHash('sha256').update(text).digest('hex') });
    if (id.endsWith('MacroDiagnostics.js')) {
      text = parse(text, { ecmaVersion: 'latest', sourceType: 'module' }).body
        .filter(node => node.type === 'FunctionDeclaration' || (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration'))
        .map(node => text.slice(node.start, node.end)).filter(piece => !piece.includes('async function onboarding')).join('\n');
    }
    return text;
  },
}], build: { write: false, minify: false, target: 'es2022', lib: { entry: 'st-macro-entry', name: 'STModernMacros', formats: ['iife'] },
  rolldownOptions: { external: ['chevrotain', 'seedrandom', 'droll', 'moment'], output: { globals: {
    chevrotain: 'chevrotain', seedrandom: 'seedrandom', droll: 'droll', moment: 'moment',
  } } } } });
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
const output = `// 从固定版本 SillyTavern 抽取宏引擎，修改日期 2026-10-25；来源与许可见 modern-sources.json、LICENSE-ST。
import * as chevrotain from 'chevrotain';
import seedrandom from 'seedrandom';
import droll from 'droll';
import moment from 'moment';
export function createModernMacroEngine(hostContext) {
const SillyTavern={getContext:()=>hostContext},console=hostContext.console;
const document={querySelector:selector=>selector==='#send_textarea'?{value:hostContext.input??''}:null};
${code}
return STModernMacros.MacroEngine;
}
`;
await writeFile(path.join(root, 'packages/core/vendor/modern-macros.mjs'), output, 'utf8');
await writeFile(path.join(root, 'packages/core/vendor/modern-sources.json'), JSON.stringify({ repository: 'https://github.com/SillyTavern/SillyTavern',
  commit: JSON.parse(await readFile(path.join(root, 'packages/core/vendor/sources.json'), 'utf8')).commit,
  files: records.sort((a, b) => a.file.localeCompare(b.file)) }, null, 2) + '\n', 'utf8');
