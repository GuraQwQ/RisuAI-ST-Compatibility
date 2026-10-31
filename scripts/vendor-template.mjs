import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? path.join(root, 'cache/upstream/prompt-template-core'));
const ts = createRequire(path.join(root, 'cache/upstream/risuai/package.json'))('typescript');
const commit = 'd6f520d149aba146305b0b781ddd691d449c28d2';
const files = ['src/utils/zodutl.ts', 'src/function/variables.ts', 'src/function/worldinfo.ts',
  'src/function/json-patch.ts', 'src/function/inject.ts', 'src/function/regex.ts'];
const records = [];
const exports = [];
let body = '';
for (const file of files) {
  const original = await readFile(path.join(source, file), 'utf8');
  records.push({ file, sha256: createHash('sha256').update(original).digest('hex') });
  const js = ts.transpileModule(original, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, removeComments: true,
  } }).outputText;
  for (const node of parse(js, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
    if (node.type === 'ImportDeclaration') continue;
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (!declaration) continue;
    if (node.type === 'ExportNamedDeclaration') {
      exports.push(...(declaration.type === 'VariableDeclaration'
        ? declaration.declarations.map(item => item.id.name) : [declaration.id.name]));
    }
    body += js.slice(declaration.start, declaration.end) + '\n';
  }
}
const header = `// 从 ST-Prompt-Template ${commit} 提取；AGPL-3.0；更新执行 scripts/vendor-template.mjs。\n`;
const module = header + `import _ from 'lodash';\nimport * as yaml from 'yaml';\nimport {z} from 'zod';\nimport {jsonrepair} from 'jsonrepair';\nexport const templateSources = ${JSON.stringify({ commit, files: records }, null, 2)};\n\nexport function createTemplatePrimitives(env) {\nconst {chat,chat_metadata,extension_settings,settings,saveChatConditional,loadWorldInfo,parseRegexFromString,\nworld_info_case_sensitive,world_info_match_whole_words,world_info_logic,world_info_use_group_scoring,\nDEFAULT_WEIGHT,METADATA_KEY,selected_world_info,world_info,DEFAULT_DEPTH,world_info_position,world_names,\nsubstituteParams,this_chid,characters,eventSource,event_types,name1,power_user,getCharaFilename,\ngetGroupMembers,evalTemplateHandler,world_info_max_recursion_steps,hashString,console,Math,toastr} = env;\n` + body + `\nreturn {${exports.join(',')}};\n}\n`;
parse(module, { ecmaVersion: 'latest', sourceType: 'module' });
await writeFile(path.join(root, 'packages/core/template-primitives.mjs'), module, 'utf8');
const contextFiles = ['src/function/characters.ts', 'src/function/chat.ts'];
let contextBody = '';
for (const file of contextFiles) {
  const sourceText = await readFile(path.join(source, file), 'utf8');
  const js = ts.transpileModule(sourceText, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022, removeComments: true } }).outputText;
  for (const node of parse(js, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
    if (node.type === 'ImportDeclaration') continue;
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (declaration) contextBody += js.slice(declaration.start, declaration.end) + '\n';
  }
}
const contextSource = await readFile(path.join(source, 'src/function/ejs.ts'), 'utf8');
const contextJS = ts.transpileModule(contextSource, { compilerOptions: { target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022, removeComments: true } }).outputText;
for (const node of parse(contextJS, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
  const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
  const name = declaration?.id?.name ?? declaration?.declarations?.[0]?.id?.name;
  if (name === 'SHARE_CONTEXT' || name === 'prepareContext' || name?.startsWith('bounded') || name === 'boundCloneDefines') {
    contextBody += contextJS.slice(declaration.start, declaration.end) + '\n';
  }
}
const contextModule = header + `import _ from 'lodash';\nimport {z} from 'zod';\nexport function createTemplateContext(env) {\nconst {chat,chat_metadata,this_chid,characters,name1,name2,getCurrentChatId,power_user,METADATA_KEY,\ngroups,selected_group,user_avatar,getThumbnailUrl,getPersonaAvatar,substituteParams,getRegexedString,regex_placement,\ngetPresetPromptsContent,getGeneratingModel,getQuickReply,getQuickReplyData,fakerEnv,executeSlashCommandsWithOptions,\neventSource,SillyTavern,$,toastr,settings,evalTemplate,SharedDefines,console,\n${exports.filter(name => !['deepMergeZod'].includes(name)).join(',')}} = env;\n` + contextBody + '\nreturn {prepareContext,getCharacterData,getCharacterDefine,DEFAULT_CHAR_DEFINE,getCharacters,getCharacterAvaterURL,getUserAvatarURL,getChatMessage,getChatMessages,matchChatMessages};\n}\n';
parse(contextModule, { ecmaVersion: 'latest', sourceType: 'module' });
await writeFile(path.join(root, 'packages/core/template-context.mjs'), contextModule, 'utf8');
console.log(`已更新模板原版算法：${records.length} 个来源文件，${exports.length} 个导出。`);
