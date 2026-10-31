// 从 ST-Prompt-Template d6f520d149aba146305b0b781ddd691d449c28d2 提取；AGPL-3.0；更新执行 scripts/vendor-template.mjs。
import _ from 'lodash';
import {z} from 'zod';
export function createTemplateContext(env) {
const {chat,chat_metadata,this_chid,characters,name1,name2,getCurrentChatId,power_user,METADATA_KEY,
groups,selected_group,user_avatar,getThumbnailUrl,getPersonaAvatar,substituteParams,getRegexedString,regex_placement,
getPresetPromptsContent,getGeneratingModel,getQuickReply,getQuickReplyData,fakerEnv,executeSlashCommandsWithOptions,
eventSource,SillyTavern,$,toastr,settings,evalTemplate,SharedDefines,console,
STATE,precacheVariables,setVariable,getVariable,removeVariable,insertVariable,increaseVariable,decreaseVariable,checkAndSave,findPreviousMessageVariables,clonePreviousMessage,dumpYamlWithSchema,setVariableSchema,activateWorldInfo,activateWorldInfoByKeywords,applyActivateWorldInfo,deactivateActivateWorldInfo,getActivatedWIEntries,getWorldInfoEntries,getWorldInfoComments,getWorldInfoEntry,getWorldInfoEntryContent,getWorldInfoActivatedEntries,selectActivatedEntries,getEnabledLoreBooks,getEnabledWorldInfoEntries,WorldInfoDecorators,parseDecorators,jsonPatch,patchVariables,parseJSON,injectPrompt,getPromptsInjected,applyOutletPromptsInjected,setForceOutlet,deactivatePromptInjection,hasPromptsInjected,activateRegex,deactivateRegex,applyRegex} = env;
function getCharacterData(name = this_chid) {
    name = name || this_chid;
    if (name == null)
        return null;
    const char = characters[name] || characters.find(c => c.name === name || c.name.match(name));
    if (!char)
        return null;
    return char;
}
function* getCharacters(include = new Set(), exclude = new Set()) {
    function hasAny(tags, matchs) {
        for (const tag of tags)
            if (matchs.has(tag))
                return true;
        return false;
    }
    for (const char of characters)
        if ((!include.size || hasAny(char.tags, include)) && !hasAny(char.tags, exclude))
            yield char.name;
}
const DEFAULT_CHAR_DEFINE = `\
<% if (name) { %>\
<<%- name %>>
<% if (system_prompt) { %>\
System: <%- system_prompt %>
<% } %>\
name: <%- name %>
<% if (personality) { %>\
personality: <%- personality %>
<% } %>\
<% if (description) { %>\
description: <%- description %>
<% } %>\
<% if (message_example) { %>\
example:
<%- message_example %>
<% } %>\
<% if (depth_prompt) { %>\
System: <%- depth_prompt %>
<% } %>\
</<%- name %>>\
<% } %>\
`;
function getCharacterDefine(name = this_chid) {
    const char = getCharacterData(name);
    if (!char)
        return null;
    let example = char.mes_example.trim();
    if (example && example.startsWith('<START>'))
        example = example.slice(7).trim();
    example = example.replace('<START>', '```\n```');
    if (example && example.includes('```'))
        example += '\n```';
    return {
        name: char.name,
        description: char.description,
        personality: char.personality,
        scenario: char.scenario,
        first_message: char.first_mes,
        message_example: example,
        creator_notes: char.data.creator_notes,
        creatorcomment: char.creatorcomment,
        system_prompt: char.data.system_prompt,
        post_history_instructions: char.data.post_history_instructions,
        alternate_greetings: char.data.alternate_greetings,
        depth_prompt: char?.data?.depth_prompt,
        creator: char?.data?.creator,
    };
}
function getUserAvatarURL() {
    return getPersonaAvatar(user_avatar);
}
function getCharacterAvaterURL(char = this_chid) {
    if (!char)
        return '';
    return getThumbnailUrl('avatar', characters[char].avatar);
}
function processMessage(message) {
    if (message == null)
        return '';
    const placement = message.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
    return substituteParams(getRegexedString(message.mes ?? '', placement, {
        characterOverride: message.name,
        isPrompt: true,
        depth: chat.length - message.id - 1,
    }));
}
function getChatMessage(idx, role) {
    const messages = Object.entries(chat)
        .map(([id, obj]) => ({ ...obj, id: Number(id) }))
        .filter(x => !role || (role === 'user' && x.is_user) || (role === 'system' && x.is_system) || (role === 'assistant' && !x.is_user && !x.is_system));
    return processMessage(messages[idx > -1 ? idx : messages.length + idx]);
}
function getChatMessages(startOrCount = chat.length, endOrRole, role) {
    if (endOrRole == null) {
        if (startOrCount > 0) {
            return Object.entries(chat)
                .map(([idx, obj]) => ({ ...obj, id: Number(idx) }))
                .slice(0, startOrCount)
                .map(processMessage);
        }
        else if (startOrCount < 0) {
            return Object.entries(chat)
                .map(([idx, obj]) => ({ ...obj, id: Number(idx) }))
                .slice(startOrCount)
                .map(processMessage);
        }
    }
    else if (typeof endOrRole === 'string') {
        if (startOrCount > 0) {
            return Object.entries(chat)
                .map(([idx, obj]) => ({ ...obj, id: Number(idx) }))
                .filter(x => (endOrRole === 'user' && x.is_user) || (endOrRole === 'system' && x.is_system) || (endOrRole === 'assistant' && !x.is_user && !x.is_system))
                .slice(0, startOrCount)
                .map(processMessage);
        }
        else if (startOrCount < 0) {
            return Object.entries(chat)
                .map(([idx, obj]) => ({ ...obj, id: Number(idx) }))
                .filter(x => (endOrRole === 'user' && x.is_user) || (endOrRole === 'system' && x.is_system) || (endOrRole === 'assistant' && !x.is_user && !x.is_system))
                .slice(startOrCount)
                .map(processMessage);
        }
    }
    else if (typeof endOrRole === 'number') {
        if (startOrCount > 0) {
            return Object.entries(chat)
                .map(([idx, obj]) => ({ ...obj, id: Number(idx) }))
                .filter(x => !role || (role === 'user' && x.is_user) || (role === 'system' && x.is_system) || (role === 'assistant' && !x.is_user && !x.is_system))
                .slice(startOrCount, endOrRole)
                .map(processMessage);
        }
        else if (startOrCount < 0) {
            return Object.entries(chat)
                .map(([idx, obj]) => ({ ...obj, id: Number(idx) }))
                .filter(x => !role || (role === 'user' && x.is_user) || (role === 'system' && x.is_system) || (role === 'assistant' && !x.is_user && !x.is_system))
                .slice(startOrCount, endOrRole)
                .map(processMessage);
        }
    }
    return [];
}
function matchChatMessages(pattern, options = {}) {
    const messages = getChatMessages(options.start ?? -2, options.end, options.role);
    if (!Array.isArray(pattern))
        pattern = [pattern];
    return messages.some(x => options.and ?
        pattern.every(y => x.match(y)) :
        pattern.some(y => x.match(y)));
}
const SHARE_CONTEXT = {
    _,
    $,
    z,
    toastr,
    console,
    getCharaData: getCharacterData,
    getCharData: getCharacterData,
    getWorldInfoData: getWorldInfoEntries,
    getQuickReplyData,
    getWorldInfoActivatedData: getWorldInfoActivatedEntries,
    getEnabledWorldInfoEntries,
    selectActivatedEntries,
    activewi: activateWorldInfo,
    activateWorldInfo,
    getChatMessage,
    getChatMessages,
    activateRegex,
    injectPrompt,
    getPromptsInjected,
    activateWorldInfoByKeywords,
    getEnabledLoreBooks,
    hasPromptsInjected,
    matchChatMessages,
    jsonPatch,
    parseJSON,
    get model() {
        return getGeneratingModel();
    },
    setVariableSchema,
};
async function prepareContext(msg_id, env = {}) {
    precacheVariables(msg_id);
    let context = {
        ...SHARE_CONTEXT,
        get variables() {
            return STATE.cacheVars;
        },
        execute: async (cmd) => (await executeSlashCommandsWithOptions(cmd)).pipe,
        get SillyTavern() {
            return SillyTavern.getContext();
        },
        faker: fakerEnv.faker,
        userName: name1,
        assistantName: name2,
        charName: name2,
        get chatId() {
            return getCurrentChatId();
        },
        characterId: this_chid,
        get charAvatar() {
            return getCharacterAvaterURL();
        },
        userAvatar: getUserAvatarURL(),
        groups,
        groupId: selected_group,
        charLoreBook: characters[this_chid]?.data?.extensions?.world,
        userLoreBook: power_user.persona_description_lorebook,
        chatLoreBook: chat_metadata[METADATA_KEY],
        get lastUserMessageId() {
            return chat.findLastIndex(msg => msg.is_user);
        },
        get lastUserMessage() {
            return chat.findLast(msg => msg.is_user)?.mes ?? '';
        },
        get lastCharMessageId() {
            return chat.findLastIndex(msg => !msg.is_user && !msg.is_system);
        },
        get lastCharMessage() {
            return chat.findLast(msg => !msg.is_user && !msg.is_system)?.mes ?? '';
        },
        get lastMessageId() {
            return chat.length - 1;
        },
        ...env,
    };
    _.merge(context, {
        getwi: boundedReadWorldinfo.bind(context),
        getWorldInfo: boundedReadWorldinfo.bind(context),
        getchr: boundedCharDef.bind(context),
        getchar: boundedCharDef.bind(context),
        getChara: boundedCharDef.bind(context),
        getprp: boundedPresetPrompt.bind(context),
        getpreset: boundedPresetPrompt.bind(context),
        getPresetPrompt: boundedPresetPrompt.bind(context),
        define: boundedDefine.bind(context),
        setvar: setVariable.bind(context),
        setLocalVar: (k, v, o = {}) => setVariable.call(context, k, v, { ...o, scope: 'local' }),
        setGlobalVar: (k, v, o = {}) => setVariable.call(context, k, v, { ...o, scope: 'global' }),
        setMessageVar: (k, v, o = {}) => setVariable.call(context, k, v, { ...o, scope: 'message' }),
        getvar: getVariable.bind(context),
        getLocalVar: (k, o = {}) => getVariable.call(context, k, { ...o, scope: 'local' }),
        getGlobalVar: (k, o = {}) => getVariable.call(context, k, { ...o, scope: 'global' }),
        getMessageVar: (k, o = {}) => getVariable.call(context, k, { ...o, scope: 'message' }),
        incvar: increaseVariable.bind(context),
        incLocalVar: (k, v = 1, o = {}) => increaseVariable.call(context, k, v, { ...o, outscope: 'local' }),
        incGlobalVar: (k, v = 1, o = {}) => increaseVariable.call(context, k, v, { ...o, outscope: 'global' }),
        incMessageVar: (k, v = 1, o = {}) => increaseVariable.call(context, k, v, { ...o, outscope: 'message' }),
        decvar: decreaseVariable.bind(context),
        decLocalVar: (k, v = 1, o = {}) => decreaseVariable.call(context, k, v, { ...o, outscope: 'local' }),
        decGlobalVar: (k, v = 1, o = {}) => decreaseVariable.call(context, k, v, { ...o, outscope: 'global' }),
        decMessageVar: (k, v = 1, o = {}) => decreaseVariable.call(context, k, v, { ...o, outscope: 'message' }),
        patchVariables: patchVariables.bind(context),
        applyVarYamlAnnotate: dumpYamlWithSchema.bind(context),
        getqr: boundedQuickReply.bind(context),
        getQuickReply: boundedQuickReply.bind(context),
        evalTemplate: boundedEvalTemplate.bind(context),
        findVariables: (key, mes_id = chat.length) => findPreviousMessageVariables(mes_id, key),
        delvar: removeVariable.bind(context),
        delLocalVar: (k, o = {}) => removeVariable.call(context, k, { ...o, scope: 'local' }),
        delGlobalVar: (k, o = {}) => removeVariable.call(context, k, { ...o, scope: 'global' }),
        delMessageVar: (k, o = {}) => removeVariable.call(context, k, { ...o, scope: 'message' }),
        insvar: insertVariable.bind(context),
        insertLocalVar: (k, v, i = undefined, o = {}) => insertVariable.call(context, k, v, i, { ...o, scope: 'local' }),
        insertGlobalVar: (k, v, i = undefined, o = {}) => insertVariable.call(context, k, v, i, { ...o, scope: 'global' }),
        insertMessageVar: (k, v, i = undefined, o = {}) => insertVariable.call(context, k, v, i, { ...o, scope: 'message' }),
        ...boundCloneDefines(context, SharedDefines),
    });
    await eventSource.emit('prompt_template_prepare', context);
    if (settings.debug_enabled) {
        console.debug(`[Prompt Template] context prepared:`);
        console.debug(context);
    }
    return context;
}
async function boundedReadWorldinfo(worldinfoOrEntry, entryOrData = {}, data = {}) {
    let wi = null;
    if (_.isPlainObject(entryOrData)) {
        wi = await getWorldInfoEntry(worldinfoOrEntry);
        data = entryOrData;
    }
    else {
        wi = await getWorldInfoEntry(worldinfoOrEntry, entryOrData);
    }
    if (wi) {
        let content = wi.content;
        if (globalThis.CustomGeneration?.DataOverride) {
            const override = new globalThis.CustomGeneration.DataOverride(chat, chat_metadata);
            content = override.getOverride(wi.world, wi.uid)?.content ?? content;
        }
        return await evalTemplate(substituteParams(getRegexedString(content, regex_placement.WORLD_INFO)), _.merge(this, data, { world_info: wi }), { when: `${wi.world}.${wi.comment}` });
    }
    console.warn(`[Prompt Template] worldinfo ${worldinfoOrEntry} or entry ${entryOrData} not found`);
    return "";
}
async function boundedCharDef(name, template = DEFAULT_CHAR_DEFINE, data = {}) {
    const defs = getCharacterDefine(name);
    if (!defs) {
        console.warn(`[Prompt Template] character ${name} not found`);
        return "";
    }
    return substituteParams(await evalTemplate(template, _.merge(this, data, defs, { chara_name: defs.name }), { when: `${name}` }), undefined, defs.name, undefined, undefined, false);
}
async function boundedPresetPrompt(name, data = {}) {
    const prompt = getPresetPromptsContent(name);
    if (!prompt) {
        console.warn(`[Prompt Template] preset prompt ${name} not found`);
        return "";
    }
    return substituteParams(await evalTemplate(prompt, _.merge(this, data, { prompt_name: name }), { when: `${name}` }));
}
function boundedDefine(name, value, merge = false) {
    const oldValue = _.get(SharedDefines, name, undefined);
    if (merge) {
        if ((oldValue === undefined || _.isArray(oldValue)) && _.isArray(value))
            value = _.concat(oldValue ?? [], value);
        else if ((oldValue === undefined || _.isPlainObject(oldValue)) && _.isPlainObject(value))
            value = _.mergeWith(oldValue ?? {}, value, (_dst, src) => _.isArray(src) ? src : undefined);
    }
    _.set(SharedDefines, name, value);
    _.set(this, name, value);
    return oldValue;
}
function boundCloneDefines(self, defines) {
    let result = {};
    if (_.isArray(defines))
        result = [];
    for (const [name, value] of _.entries(defines)) {
        if (_.isFunction(value)) {
            result[name] = value.bind(self);
        }
        else if (_.isArray(value) || _.isPlainObject(value)) {
            result[name] = boundCloneDefines(self, value);
        }
        else {
            result[name] = value;
        }
    }
    return result;
}
async function boundedQuickReply(name, label, data = {}) {
    const reply = getQuickReply(name, label);
    if (!reply) {
        console.warn(`[Prompt Template] quick reply ${name}.${label} not found`);
        return '';
    }
    return substituteParams(await evalTemplate(reply, _.merge(this, data, { qr_name: name, qr_label: label }), { when: `${name}.${label}` }));
}
async function boundedEvalTemplate(content, data = {}, options = {}) {
    return substituteParams(await evalTemplate(content, _.merge(this, data), { when: `evalTemplate`, options }));
}

return {prepareContext,getCharacterData,getCharacterDefine,DEFAULT_CHAR_DEFINE,getCharacters,getCharacterAvaterURL,getUserAvatarURL,getChatMessage,getChatMessages,matchChatMessages};
}
