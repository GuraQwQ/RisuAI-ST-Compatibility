// 从 ST-Prompt-Template d6f520d149aba146305b0b781ddd691d449c28d2 提取；AGPL-3.0；更新执行 scripts/vendor-template.mjs。
import _ from 'lodash';
import * as yaml from 'yaml';
import {z} from 'zod';
import {jsonrepair} from 'jsonrepair';
export const templateSources = {
  "commit": "d6f520d149aba146305b0b781ddd691d449c28d2",
  "files": [
    {
      "file": "src/utils/zodutl.ts",
      "sha256": "20bf4ef0320f81ca9cb9373d3b8d1369e6bdb089c8d8ee9b1fa1fb1aabaa6d6b"
    },
    {
      "file": "src/function/variables.ts",
      "sha256": "0c0f671975195fefee6dcebce19fd59a2c36528fd7ab52419490b2c259d0db1c"
    },
    {
      "file": "src/function/worldinfo.ts",
      "sha256": "7681354d011b16c5bfaab01bba212651dfd42edcf1fd85b3aea089d03f8ea02f"
    },
    {
      "file": "src/function/json-patch.ts",
      "sha256": "bad188c6e8b62869155c3eadb48a4eb05110c5b258766a2bf5e5c6a1f45a96d9"
    },
    {
      "file": "src/function/inject.ts",
      "sha256": "04dca525b16ce33c393b9e349aee3c37e0ded48206a8eecc069ab93e819cb9de"
    },
    {
      "file": "src/function/regex.ts",
      "sha256": "1737ae865488dd20194a6e061e738d1d71e64cb6c777dd8d13af97bcb3bd3e42"
    }
  ]
};

export function createTemplatePrimitives(env) {
const {chat,chat_metadata,extension_settings,settings,saveChatConditional,loadWorldInfo,parseRegexFromString,
world_info_case_sensitive,world_info_match_whole_words,world_info_logic,world_info_use_group_scoring,
DEFAULT_WEIGHT,METADATA_KEY,selected_world_info,world_info,DEFAULT_DEPTH,world_info_position,world_names,
substituteParams,this_chid,characters,eventSource,event_types,name1,power_user,getCharaFilename,
getGroupMembers,evalTemplateHandler,world_info_max_recursion_steps,hashString,console,Math,toastr} = env;
function deepMergeZod(schemaA, schemaB) {
    const unwrappedA = unwrapZodType(schemaA);
    const unwrappedB = unwrapZodType(schemaB);
    let mergedCore;
    const typeA = unwrappedA.core._def?.typeName ?? unwrappedA.core.def?.type;
    const typeB = unwrappedB.core._def?.typeName ?? unwrappedB.core.def?.type;
    const isObjA = typeA === 'ZodObject' || typeA === 'object';
    const isObjB = typeB === 'ZodObject' || typeB === 'object';
    const isArrA = typeA === 'ZodArray' || typeA === 'array';
    const isArrB = typeB === 'ZodArray' || typeB === 'array';
    if (isObjA && isObjB) {
        const shapeA = unwrappedA.core.shape || unwrappedA.core.def?.def?.shape;
        const shapeB = unwrappedB.core.shape || unwrappedB.core.def?.def?.shape;
        const mergedShape = { ...shapeA };
        for (const key in shapeB) {
            if (key in shapeA) {
                mergedShape[key] = deepMergeZod(shapeA[key], shapeB[key]);
            }
            else {
                mergedShape[key] = shapeB[key];
            }
        }
        mergedCore = z.object(mergedShape);
    }
    else if (isArrA && isArrB) {
        const elementA = unwrappedA.core.element || unwrappedA.core.def?.def?.element;
        const elementB = unwrappedB.core.element || unwrappedB.core.def?.def?.element;
        mergedCore = z.array(deepMergeZod(elementA, elementB));
    }
    else {
        mergedCore = unwrappedB.core;
    }
    const ukA = getUnknownKeysStrategy(unwrappedA.core);
    const ukB = getUnknownKeysStrategy(unwrappedB.core);
    if ((ukB === 'passthrough' || ukB === 'unknown' || ukA === 'unknown' || ukA === 'passthrough') && ukA !== 'never' && ukB !== 'never') {
        mergedCore = mergedCore.loose();
    }
    let finalSchema = mergedCore;
    if (unwrappedB.isNullable)
        finalSchema = finalSchema.nullable();
    if (unwrappedB.isOptional)
        finalSchema = finalSchema.optional();
    return finalSchema;
}
function unwrapZodType(schema) {
    let isOptional = false;
    let isNullable = false;
    let current = schema;
    while (current && typeof current.unwrap === 'function') {
        const typeName = current._def?.typeName ?? current.def?.type;
        if (typeName === 'ZodOptional' || typeName === 'optional') {
            isOptional = true;
            current = current.unwrap();
        }
        else if (typeName === 'ZodNullable' || typeName === 'nullable') {
            isNullable = true;
            current = current.unwrap();
        }
        else {
            break;
        }
    }
    return { core: current, isOptional, isNullable };
}
function getUnknownKeysStrategy(schemaCore) {
    return schemaCore._def?.unknownKeys ?? schemaCore._def?.catchall?.type ?? schemaCore.def?.catchall?.type ?? 'strip';
}
let STATE = {
    isDryRun: false,
    cacheVars: {},
    traceId: 0,
    initialVariables: {},
    isInPlace: false,
    messageId: -1,
    swipeId: -1,
};
function precacheVariables(msg_id, sw_id) {
    if (chat.length < 1) {
        STATE.cacheVars = {};
        return STATE.cacheVars;
    }
    clonePreviousMessage(msg_id ?? chat.length - 1);
    STATE.messageId = msg_id ?? chat.length - 1;
    if (STATE.messageId < 0)
        STATE.messageId = chat.length + STATE.messageId;
    if (STATE.messageId >= chat.length)
        STATE.messageId = chat.length - 1;
    STATE.swipeId = sw_id ?? chat[STATE.messageId].swipe_id ?? 0;
    const msgVars = ensureVariable(STATE.messageId, STATE.swipeId);
    STATE.cacheVars = _.cloneDeep(Object.assign({}, extension_settings.variables.global, STATE.initialVariables, chat_metadata.variables ?? {}, msgVars ?? {}, { _trace_id: (STATE.traceId)++, _modify_id: 0 }));
    console.debug(`[Prompt Template] message #${STATE.messageId}.${STATE.swipeId} variables: `, chat[STATE.messageId]?.variables?.[STATE.swipeId]);
    console.debug(`[Prompt Template] all variables: `, STATE.cacheVars);
    return STATE.cacheVars;
}
function evalMessageFilter(filter, msgid, swipeid, getter = false) {
    let message_id = -1;
    if (filter?.id !== undefined) {
        message_id = filter.id > -1 ? filter.id : chat.length + filter.id;
    }
    else if (filter?.role !== undefined) {
        message_id = chat.findLastIndex((msg) => ((msg.is_system === (filter.role === 'system')) ||
            (msg.is_user === (filter.role === 'user')) ||
            (!msg.is_system && !msg.is_user && (filter.role === 'assistant')) ||
            (filter.role === 'any')) && (!getter ||
            msg.variables?.[msg.swipe_id ?? 0] != null));
    }
    else if (msgid === undefined) {
        message_id = chat.findLastIndex((msg) => !getter || msg.variables?.[msg.swipe_id ?? 0] != null);
    }
    else {
        if (msgid > chat.length)
            msgid = chat.length - 1;
        else if (msgid < 0)
            msgid = chat.length + msgid;
        message_id = msgid;
        if (getter) {
            message_id = chat.slice(0, msgid + 1).findLastIndex((msg) => msg.variables?.[msg.swipe_id ?? 0] != null);
        }
    }
    if (message_id < 0 || message_id >= chat.length) {
        console.warn(`No message found for filter: ${filter}`);
        return [undefined, undefined];
    }
    let swipe_id = 0;
    if (filter?.swipe_id !== undefined)
        swipe_id = filter.swipe_id;
    else if (swipeid !== undefined)
        swipe_id = swipeid;
    else
        swipe_id = chat[message_id]?.swipe_id || 0;
    if (swipe_id < 0)
        swipe_id = (chat[message_id]?.swipes?.length || 0) + swipe_id;
    if (chat[message_id]?.swipes?.[swipe_id] === undefined) {
        console.debug(`No swipe found for filter: ${filter}`);
        return [message_id, swipe_id];
    }
    if (settings.debug_enabled)
        console.debug(`Found message ${message_id} with swipe ${swipe_id} for filter: ${filter}`);
    return [message_id, swipe_id];
}
function setVariable(key, value, options = {}) {
    options = optionsConverter(options);
    const { noCache } = options;
    if (noCache || this?.runID === undefined) {
        precacheVariables(this?.message_id);
        if (settings.debug_enabled) {
            console.debug(`[Prompt Template] reload variables cache:`);
            console.debug(STATE.cacheVars);
        }
    }
    const { index, scope, flags, results, withMsg, merge, dryRun } = options;
    if (!dryRun && STATE.isDryRun)
        return undefined;
    let oldValue;
    let newValue = value;
    if (index != null) {
        let data = JSON.parse(get(STATE.cacheVars, key, '{}'));
        let idx = Number(index);
        idx = Number.isNaN(idx) ? index : idx;
        if (flags === 'nx' && has(data, idx))
            return undefined;
        if (flags === 'xx' && !has(data, idx))
            return undefined;
        if (flags === 'nxs' && getVariable.call(this, key, options) !== undefined)
            return undefined;
        if (flags === 'xxs' && getVariable.call(this, key, options) === undefined)
            return undefined;
        if (results === 'old' || merge)
            oldValue = get(data, idx, undefined);
        if (merge) {
            if ((oldValue === undefined || _.isArray(oldValue)) && _.isArray(value)) {
                newValue = _.concat(oldValue ?? [], value);
            }
            else {
                newValue = _.mergeWith(_.cloneDeep(oldValue ?? {}), value, (_dst, src) => _.isArray(src) ? src : undefined);
            }
        }
        newValue === undefined ? unset(data, idx) : set(data, idx, newValue);
        set(STATE.cacheVars, key, JSON.stringify(data));
        switch (scope || 'message') {
            case 'global':
                data = JSON.parse(get(extension_settings.variables.global, key, '{}') || '{}');
                newValue === undefined ? unset(data, idx) : set(data, idx, newValue);
                set(extension_settings.variables.global, key, JSON.stringify(data));
                if (settings.debug_enabled)
                    console.debug(`Set global variable ${key} to ${newValue} (index ${idx})`);
                break;
            case 'local':
                if (!chat_metadata.variables)
                    chat_metadata.variables = {};
                data = JSON.parse(get(chat_metadata.variables, key, '{}') || '{}');
                newValue === undefined ? unset(data, idx) : set(data, idx, newValue);
                set(chat_metadata.variables, key, JSON.stringify(data));
                if (settings.debug_enabled)
                    console.debug(`Set local variable ${key} to ${newValue} (index ${idx})`);
                break;
            case 'message':
                if (withMsg) {
                    const [message_id, swipe_id] = evalMessageFilter(withMsg, this?.message_id, this?.swipe_id, false);
                    if (message_id !== undefined && swipe_id !== undefined) {
                        const msgVars = ensureVariable(message_id, swipe_id) ?? {};
                        data = JSON.parse(get(msgVars, key, '{}') || '{}');
                        newValue === undefined ? unset(data, idx) : set(data, idx, newValue);
                        set(chat[message_id].variables[swipe_id], key, JSON.stringify(data));
                        if (message_id === STATE.messageId && swipe_id === STATE.swipeId)
                            set(STATE.cacheVars, key, JSON.stringify(data));
                        if (settings.debug_enabled)
                            console.debug(`Set message #${message_id}.${swipe_id} variable ${key} to ${newValue} (index ${idx})`);
                    }
                }
                else {
                    data = JSON.parse(get(STATE.cacheVars, key, '{}') || '{}');
                    newValue === undefined ? unset(data, idx) : set(data, idx, newValue);
                    set(chat[STATE.messageId].variables[STATE.swipeId], key, JSON.stringify(data));
                    set(STATE.cacheVars, key, JSON.stringify(data));
                    if (settings.debug_enabled)
                        console.debug(`Set message variable ${key} to ${newValue} (index ${idx})`);
                }
                break;
            case 'initial':
                data = JSON.parse(get(STATE.initialVariables, key, '{}') || '{}');
                newValue === undefined ? unset(data, idx) : set(data, idx, newValue);
                set(STATE.initialVariables, key, JSON.stringify(data));
                if (settings.debug_enabled)
                    console.debug(`Set initial variable ${key} to ${newValue} (index ${idx})`);
                break;
        }
        STATE.cacheVars._modify_id = STATE.cacheVars._modify_id + 1 || 1;
    }
    else {
        if (flags === 'nx' && has(STATE.cacheVars, key))
            return undefined;
        if (flags === 'xx' && !has(STATE.cacheVars, key))
            return undefined;
        if (flags === 'nxs' && getVariable.call(this, key, options) !== undefined)
            return undefined;
        if (flags === 'xxs' && getVariable.call(this, key, options) === undefined)
            return undefined;
        if (results === 'old' || merge)
            oldValue = get(STATE.cacheVars, key, undefined);
        if (merge) {
            if ((oldValue === undefined || _.isArray(oldValue)) && _.isArray(value))
                newValue = _.concat(oldValue ?? [], value);
            else
                newValue = _.mergeWith(_.cloneDeep(oldValue ?? {}), value, (_dst, src) => _.isArray(src) ? src : undefined);
        }
        newValue === undefined ? unset(STATE.cacheVars, key) : set(STATE.cacheVars, key, newValue);
        switch (scope || 'message') {
            case 'global':
                if (newValue === undefined)
                    unset(extension_settings.variables.global, key);
                else
                    set(extension_settings.variables.global, key, newValue);
                if (settings.debug_enabled)
                    console.debug(`Set global variable ${key} to ${newValue}`);
                break;
            case 'local':
                if (!chat_metadata.variables)
                    chat_metadata.variables = {};
                if (newValue === undefined)
                    unset(chat_metadata.variables, key);
                else
                    set(chat_metadata.variables, key, newValue);
                if (settings.debug_enabled)
                    console.debug(`Set local variable ${key} to ${newValue}`);
                break;
            case 'message':
                if (withMsg) {
                    const [message_id, swipe_id] = evalMessageFilter(withMsg, this?.message_id, this?.swipe_id, false);
                    if (message_id !== undefined && swipe_id !== undefined) {
                        ensureVariable(message_id, swipe_id);
                        if (newValue === undefined) {
                            unset(chat[message_id].variables[swipe_id], key);
                            if (message_id === STATE.messageId && swipe_id === STATE.swipeId)
                                unset(STATE.cacheVars, key);
                        }
                        else {
                            set(chat[message_id].variables[swipe_id], key, newValue);
                            if (message_id === STATE.messageId && swipe_id === STATE.swipeId)
                                set(STATE.cacheVars, key, newValue);
                        }
                        if (settings.debug_enabled)
                            console.debug(`Set message #${message_id}.${swipe_id} variable ${key} to ${newValue}`);
                    }
                }
                else {
                    if (newValue === undefined) {
                        unset(STATE.cacheVars, key);
                        unset(chat[STATE.messageId].variables[STATE.swipeId], key);
                    }
                    else {
                        set(STATE.cacheVars, key, newValue);
                        set(chat[STATE.messageId].variables[STATE.swipeId], key, newValue);
                    }
                    if (settings.debug_enabled)
                        console.debug(`Set message variable ${key} to ${newValue}`);
                }
                break;
            case 'initial':
                if (newValue === undefined)
                    unset(STATE.initialVariables, key);
                else
                    set(STATE.initialVariables, key, newValue);
                if (settings.debug_enabled)
                    console.debug(`Set initial variable ${key} to ${newValue}`);
                break;
        }
        STATE.cacheVars._modify_id = STATE.cacheVars._modify_id + 1 || 1;
    }
    if (results === 'old')
        return oldValue;
    if (results === 'fullcache')
        return STATE.cacheVars;
    return newValue;
}
function getVariable(key, options = {}) {
    options = optionsConverter(options);
    const { noCache } = options;
    if (noCache || this?.runID === undefined) {
        precacheVariables(this?.message_id);
        if (settings.debug_enabled) {
            console.debug(`[Prompt Template] reload variables cache:`);
            console.debug(STATE.cacheVars);
        }
    }
    let result = null;
    const { index, scope, defaults, withMsg } = options;
    switch (scope || 'cache') {
        case 'global':
            if (index != null) {
                const data = JSON.parse(get(extension_settings.variables.global, key, '{}') || '{}');
                const idx = Number(index);
                return get(data, Number.isNaN(idx) ? index : idx, defaults);
            }
            result = get(extension_settings.variables.global, key, defaults);
            return options.clone ? _.cloneDeep(result) : result;
        case 'local':
            if (!chat_metadata.variables)
                return defaults;
            if (index != null) {
                const data = JSON.parse(get(chat_metadata.variables, key, '{}') || '{}');
                const idx = Number(index);
                return get(data, Number.isNaN(idx) ? index : idx, defaults);
            }
            result = get(chat_metadata.variables, key, defaults);
            return options.clone ? _.cloneDeep(result) : result;
        case 'message':
            if (withMsg) {
                const [message_id, swipe_id] = evalMessageFilter(withMsg, this?.message_id, this?.swipe_id, true);
                if (message_id !== undefined && swipe_id !== undefined) {
                    if (!chat[message_id]?.variables?.[swipe_id])
                        return defaults;
                    if (index != null) {
                        const data = JSON.parse(get(chat[message_id].variables[swipe_id], key, '{}') || '{}');
                        const idx = Number(index);
                        return get(data, Number.isNaN(idx) ? index : idx, defaults);
                    }
                    result = get(chat[message_id].variables[swipe_id], key, defaults);
                    return options.clone ? _.cloneDeep(result) : result;
                }
                return defaults;
            }
            else {
                if (index != null) {
                    const data = JSON.parse(get(STATE.cacheVars, key, '{}') || '{}');
                    const idx = Number(index);
                    return get(data, Number.isNaN(idx) ? index : idx, defaults);
                }
                result = get(STATE.cacheVars, key, defaults);
                return options.clone ? _.cloneDeep(result) : result;
            }
        case 'initial':
            if (index != null) {
                const data = JSON.parse(get(STATE.initialVariables, key, '{}') || '{}');
                const idx = Number(index);
                return get(data, Number.isNaN(idx) ? index : idx, defaults);
            }
            result = get(STATE.initialVariables, key, defaults);
            return options.clone ? _.cloneDeep(result) : result;
    }
    if (index != null) {
        const data = JSON.parse(get(STATE.cacheVars, key, '{}') || '{}');
        const idx = Number(index);
        return get(data, idx, defaults);
    }
    return get(STATE.cacheVars, key, defaults);
}
function removeVariable(key, index = undefined, options = {}) {
    if (index == null) {
        return setVariable.call(this, key, undefined, options);
    }
    else {
        const variable = getVariable.call(this, key, options);
        if (_.isArray(variable)) {
            const idx = variable.indexOf(index);
            if (idx !== -1) {
                variable.splice(idx, 1);
                return setVariable.call(this, key, variable, options);
            }
        }
        else if (_.isObject(variable)) {
            delete variable[index.toString()];
            return setVariable.call(this, key, variable, options);
        }
        else if (_.isString(variable) && _.isString(index)) {
            const idx = variable.indexOf(index);
            if (idx !== -1) {
                variable.splice(idx, index.length);
                return setVariable.call(this, key, variable, options);
            }
        }
    }
    return undefined;
}
function insertVariable(key, value, index = undefined, options = {}) {
    options = optionsConverter(options);
    let variable = getVariable.call(this, key, options);
    if (_.isArray(variable)) {
        if (index == null) {
            variable.push(value);
        }
        else {
            index = Number(index) < 0 ? variable.length + Number(index) : Number(index);
            variable.splice(index, 0, value);
        }
        return setVariable.call(this, key, variable, options);
    }
    else if (_.isObject(variable) && index != null) {
        const exists = variable.hasOwnProperty(index.toString());
        if (options.flags?.includes('nx') && exists)
            return undefined;
        if (options.flags?.includes('xx') && !exists)
            return undefined;
        variable[index.toString()] = value;
        return setVariable.call(this, key, variable, options);
    }
    else if (_.isString(variable)) {
        if (index == null) {
            variable += value.toString();
        }
        else if (_.isString(index)) {
            const idx = variable.indexOf(index);
            if (idx !== -1) {
                variable.splice(idx, value.toString().length, value.toString());
            }
        }
        else {
            index = Number(index) < 0 ? variable.length + Number(index) : Number(index);
            variable.splice(Number(index), 0, value.toString());
        }
        return setVariable.call(this, key, variable, options);
    }
    return undefined;
}
function increaseVariable(key, value = 1, options = {}) {
    options = optionsConverter(options);
    const { noCache } = options;
    if (noCache || this?.runID === undefined) {
        precacheVariables(this?.message_id);
        if (settings.debug_enabled) {
            console.debug(`[Prompt Template] reload variables cache:`);
            console.debug(STATE.cacheVars);
        }
    }
    const { index, inscope, outscope, flags, defaults, results, withMsg, dryRun, min, max } = options;
    if ((flags === 'nx' && !has(STATE.cacheVars, key)) ||
        (flags === 'xx' && has(STATE.cacheVars, key)) ||
        (flags === 'nxs' && getVariable.call(this, key, { index, withMsg, scope: inscope }) === undefined) ||
        (flags === 'xxs' && getVariable.call(this, key, { index, withMsg, scope: inscope }) !== undefined) ||
        (flags === 'n' || flags === undefined)) {
        let val = getVariable.call(this, key, { index, withMsg, scope: inscope, defaults: defaults || 0 }) + value;
        if (min != null)
            val = Math.max(val, min);
        if (max != null)
            val = Math.min(val, max);
        return setVariable.call(this, key, val, { index, results, withMsg, dryRun, scope: outscope, flags: 'n' });
    }
    return undefined;
}
function decreaseVariable(key, value = 1, options = {}) {
    options = optionsConverter(options);
    if (this?.runID === undefined)
        console.warn(`setVariable called with invalid context ${this}`);
    return increaseVariable.call(this, key, -value, options);
}
async function checkAndSave(force = false) {
    if (force || settings.autosave_enabled !== false)
        await saveChatConditional();
}
function get(obj, key, defaults) {
    if (key == null)
        return obj;
    return _.get(obj, key, defaults);
}
function set(obj, key, value) {
    const res = STATE.schema ? _.cloneDeep(obj) : obj;
    if (key == null)
        Object.assign(res, value);
    else
        _.set(res, key, value);
    if (STATE.schema) {
        const validated = STATE.schema.safeParse(res);
        if (!validated.success)
            throw new Error(`failed to validate schema: ${JSON.stringify(z.treeifyError(validated.error))}`);
        Object.assign(obj, validated.data);
    }
    return res;
}
function unset(obj, key) {
    const res = STATE.schema ? _.cloneDeep(obj) : obj;
    if (key == null)
        Object.keys(obj).forEach(k => delete res[k]);
    _.unset(res, key);
    if (STATE.schema) {
        const validated = STATE.schema.safeParse(res);
        if (!validated.success)
            throw new Error(`failed to validate schema: ${JSON.stringify(z.treeifyError(validated.error))}`);
        Object.assign(obj, validated.data);
    }
    return res;
}
function has(obj, key) {
    if (key == null)
        return Object.keys(obj).length > 0;
    return _.has(obj, key);
}
function optionsConverter(options) {
    if (typeof options === 'string') {
        switch (options) {
            case 'old':
            case 'new':
            case 'fullcache':
                return { results: options };
            case 'nx':
            case 'xx':
            case 'nxs':
            case 'xxs':
            case 'n':
                return { flags: options };
            case 'cache':
            case 'global':
            case 'local':
            case 'message':
            case 'initial':
                return { scope: options, inscope: options, outscope: options };
        }
    }
    if (typeof options === 'boolean') {
        return { dryRun: options };
    }
    return options;
}
function findPreviousMessageVariables(message_id, key) {
    const message = chat
        .slice(0, message_id)
        .findLast((msg) => msg.variables?.[msg?.swipe_id ?? 0] != null &&
        (key == null || get(msg.variables?.[msg?.swipe_id ?? 0], key, null) != null));
    return message?.variables?.[message.swipe_id ?? 0] ?? STATE.initialVariables;
}
function clonePreviousMessage(message_id, swipe_id) {
    if (chat[message_id] == null || chat[message_id - 1] == null)
        return false;
    const message = chat[message_id];
    swipe_id = swipe_id ?? message.swipe_id ?? 0;
    if (message.variables_initialized?.[swipe_id])
        return false;
    const lastVars = ensureVariable(message_id, swipe_id);
    const prevVars = findPreviousMessageVariables(message_id);
    message.variables[swipe_id] = _.cloneDeep(Object.assign({}, prevVars, lastVars));
    message.variables_initialized[swipe_id] = true;
    console.debug(`[Prompt Template] clone previous message variables: `, message.variables[swipe_id]);
    return true;
}
function ensureVariable(message_id, swipe_id = 0, defaults = {}) {
    const message = chat[message_id];
    if (message) {
        if (!message.variables) {
            message.variables = [];
        }
        else if (!Array.isArray(message.variables)) {
            message.variables = Object.assign([], message.variables);
        }
        if (!message.variables[swipe_id]) {
            message.variables[swipe_id] = defaults;
        }
        if (!message.variables_initialized) {
            message.variables_initialized = [];
        }
        else if (!Array.isArray(message.variables_initialized)) {
            message.variables_initialized = Object.assign([], message.variables_initialized);
        }
        return message.variables[swipe_id];
    }
    return null;
}
function dumpYamlWithSchema(key = null, schema = '') {
    if (!schema) {
        return yaml.stringify(getVariable.call(this, key));
    }
    const tree = yaml.parseDocument(schema);
    const vars = getVariable.call(this, key);
    function deepSet(doc, update) {
        if (doc == null || update == null)
            return;
        if (_.isPlainObject(update)) {
            for (const [key, value] of Object.entries(update)) {
                deepSet(doc.getIn([key]), value);
            }
        }
        else {
            doc.setIn([key], update);
        }
    }
    deepSet(tree, vars);
    return tree.toString();
}
function setVariableSchema(schema) {
    if (schema.type !== 'object') {
        if (_.isPlainObject(schema))
            schema = z.looseObject(schema);
        else
            throw new Error('Schema root must be an object');
    }
    if (STATE.schema)
        STATE.schema = deepMergeZod(STATE.schema, schema);
    else
        STATE.schema = deepMergeZod(z.looseObject({}), schema);
}
const KNOWN_DECORATORS = new Set([
    '@@activate',
    '@@dont_activate',
    '@@message_formatting',
    '@@generate_before',
    '@@generate_after',
    '@@render_before',
    '@@render_after',
    '@@dont_preload',
    '@@initial_variables',
    '@@always_enabled',
    '@@only_preload',
    '@@preload',
    '@@iframe',
    '@@preprocessing',
    '@@if',
    '@@private',
]);
let activatedWorldEntries = new Map();
async function activateWorldInfo(world, uid, force) {
    const entry = await getWorldInfoEntry(world, typeof uid === 'boolean' ? undefined : uid);
    if (entry) {
        force = typeof uid === 'boolean' ? uid : force;
        activatedWorldEntries.set(`${world}.${uid}`, {
            ...entry,
            disable: false,
            constant: force ? true : entry.constant,
            cooldown: force ? 0 : entry.cooldown,
            delay: force ? 0 : entry.delay,
            vectorized: force ? false : entry.vectorized,
            delayUntilRecursion: force ? false : entry.vectorized,
            triggers: force ? [] : entry.triggers,
            hash: force ? Math.random() + 1 : undefined,
            content: force ? entry.content.replace("@@dont_activate", "") : entry.content,
            ignoreBudget: force || entry.ignoreBudget,
            group: force ? "" : entry.group,
        });
        if (settings.debug_enabled) {
            if (uid != null && typeof uid !== 'boolean')
                console.log(`[Prompt Template] Activated WI entry ${world}.${uid} (force: ${force}`);
            else
                console.log(`[Prompt Template] Activated WI entry ${world} (force: ${force}`);
        }
    }
    return entry;
}
async function activateWorldInfoByKeywords(keywords, condition = {}) {
    const entries = await getEnabledWorldInfoEntries();
    const activated = selectActivatedEntries(entries, keywords, condition);
    activated.forEach(x => activateWorldInfo(x.world, x.uid, condition.force));
    return activated;
}
async function applyActivateWorldInfo() {
    await eventSource.emit(event_types.WORLDINFO_FORCE_ACTIVATE, activatedWorldEntries.values().filter(e => e.hash));
}
function deactivateActivateWorldInfo() {
    activatedWorldEntries.clear();
}
function getActivatedWIEntries() {
    return Array.from(activatedWorldEntries.values());
}
async function getWorldInfoEntries(name) {
    const lore = (name || characters[this_chid]?.data?.extensions?.world || power_user.persona_description_lorebook || chat_metadata[METADATA_KEY] || '');
    const lorebook = await loadWorldInfo(lore);
    if (!lorebook) {
        console.log(`[Prompt Template] lorebook not found: ${lore} (${name})`);
        return [];
    }
    const entries = Object.values(lorebook.entries).map(entry => {
        const clone = { ...entry };
        clone.uid = Number(entry.uid);
        const [decorators, content] = parseDecorators(entry.content);
        clone.decorators = decorators;
        clone.content = content;
        clone.world = lore;
        return clone;
    });
    return entries.sort(getWorldInfoSorter(entries));
}
async function getWorldInfoComments(name) {
    return (await getWorldInfoEntries(name)).map(data => data.comment);
}
async function getWorldInfoEntry(name, title) {
    let entries = [];
    if (title != null) {
        entries = await getWorldInfoEntries(name || undefined);
    }
    else {
        entries = await getWorldInfoEntries();
        title = name;
        name = '';
    }
    for (const data of entries) {
        if (data.comment === title || data.uid === title || data.comment.match(title))
            return data;
    }
    if (entries.length)
        console.warn(`[Prompt Template] entry ${title} not found in ${name ?? entries?.[0]?.world ?? '?'}`);
    if (!name && typeof title !== 'number') {
        for (const lorebook of getEnabledLoreBooks()) {
            if (lorebook === entries?.[0]?.world)
                continue;
            for (const data of await getWorldInfoEntries(lorebook)) {
                if (data.comment === title || data.comment.match(title)) {
                    console.debug(`[Prompt Template] entry ${title} found in ${lorebook} when fuzzy searching`);
                    return data;
                }
            }
        }
    }
    return null;
}
async function getWorldInfoEntryContent(name, title) {
    const data = await getWorldInfoEntry(name, title);
    if (!data)
        return null;
    return data.content;
}
async function getWorldInfoActivatedEntries(name, keywords, condition = {}) {
    const entries = await getWorldInfoEntries(name);
    if (!entries)
        return [];
    return selectActivatedEntries(entries, keywords, condition);
}
function selectActivatedEntries(entries, keywords, condition = {}) {
    let activated = new Set();
    const trigger = _.castArray(keywords).join('\n\n');
    for (const data of entries) {
        if (condition.constant != null && data.constant !== condition.constant)
            continue;
        if (condition.disabled != null && data.disable !== condition.disabled)
            continue;
        if (condition.vectorized != null && data.vectorized !== condition.vectorized)
            continue;
        if (data.useProbability && data.probability < _.random(1, 100))
            continue;
        if (data.constant) {
            activated.add(data);
            continue;
        }
        if (data.decorators.includes('@@activate')) {
            activated.add(data);
            continue;
        }
        if (data.decorators.includes('@@dont_activate')) {
            continue;
        }
        if (data.decorators.includes('@@only_preload')) {
            continue;
        }
        const matchedKey = data.key.map(k => substituteParams(k)).find(k => matchKeys(trigger, k, data));
        if (!matchedKey)
            continue;
        const hasSecondaryKey = data.selective && _.isArray(data.keysecondary) && data.keysecondary.length > 0;
        if (!hasSecondaryKey) {
            activated.add(data);
            continue;
        }
        const selectiveLogic = data.selectiveLogic ?? 0;
        let hasAnyMatch = false;
        let hasAllMatch = true;
        for (const secondary of data.keysecondary) {
            const secondarySubstituted = substituteParams(secondary);
            const hasSecondaryMatch = secondarySubstituted && matchKeys(trigger, secondarySubstituted.trim(), data);
            if (hasSecondaryMatch)
                hasAnyMatch = true;
            if (!hasSecondaryMatch)
                hasAllMatch = false;
            if (selectiveLogic === world_info_logic.AND_ANY && hasSecondaryMatch) {
                activated.add(data);
                break;
            }
            if (selectiveLogic === world_info_logic.NOT_ALL && !hasSecondaryMatch) {
                activated.add(data);
                break;
            }
        }
        if (selectiveLogic === world_info_logic.NOT_ANY && !hasAnyMatch) {
            activated.add(data);
            continue;
        }
        if (selectiveLogic === world_info_logic.AND_ALL && hasAllMatch) {
            activated.add(data);
            continue;
        }
    }
    if (activated.size <= 0)
        return [];
    const grouped = _.groupBy(Array.from(activated), (data) => data.group);
    const ungrouped = grouped[''] || [];
    if (ungrouped.length > 0 && _.size(grouped) <= 1) {
        return ungrouped.sort(getWorldInfoSorter(ungrouped));
    }
    let matched = [];
    for (const [group, datas] of Object.entries(grouped)) {
        if (group === '')
            continue;
        if (datas.length === 1) {
            matched.push(datas[0]);
            continue;
        }
        const usePrioritize = datas.filter((data) => data.groupOverride);
        if (usePrioritize.length > 0) {
            const orders = datas.map((data) => data.order);
            const top = Math.min(...orders);
            if (top) {
                matched.push(datas[Math.max(orders.findIndex(order => order <= top), 0)]);
                continue;
            }
        }
        const useScores = datas.filter(data => data.useGroupScoring ?? world_info_use_group_scoring);
        if (useScores.length > 0) {
            const scores = datas.map(data => getScore(trigger, data));
            const top = Math.max(...scores);
            if (top) {
                matched.push(datas[Math.max(scores.findIndex(score => score >= top), 0)]);
                continue;
            }
        }
        const useWeights = datas.filter(data => !data.groupOverride && !data.useGroupScoring);
        if (useWeights.length > 0) {
            const weights = datas.map(data => data.groupWeight ?? DEFAULT_WEIGHT);
            const totalWeight = _.sum(weights);
            let rollValue = _.random(1, totalWeight);
            const winner = weights.findIndex(weight => (rollValue -= weight) <= 0);
            if (winner >= 0)
                matched.push(datas[winner]);
        }
    }
    const unsorted = ungrouped.concat(matched);
    return unsorted.sort(getWorldInfoSorter(unsorted));
}
function transformString(str, entry) {
    const caseSensitive = entry.caseSensitive ?? world_info_case_sensitive;
    return caseSensitive ? str : str.toLowerCase();
}
function matchKeys(haystack, needle, entry) {
    const keyRegex = parseRegexFromString(needle);
    if (keyRegex) {
        return keyRegex.test(haystack);
    }
    haystack = transformString(haystack, entry);
    const transformedString = transformString(needle, entry);
    const matchWholeWords = entry.matchWholeWords ?? world_info_match_whole_words;
    if (matchWholeWords) {
        const keyWords = transformedString.split(/\s+/);
        if (keyWords.length > 1) {
            return haystack.includes(transformedString);
        }
        else {
            const regex = new RegExp(`(?:^|\\W)(${_.escapeRegExp(transformedString)})(?:$|\\W)`);
            if (regex.test(haystack)) {
                return true;
            }
        }
    }
    else {
        return haystack.includes(transformedString);
    }
    return false;
}
function getScore(haystack, entry) {
    const bufferState = haystack;
    let numberOfPrimaryKeys = 0;
    let numberOfSecondaryKeys = 0;
    let primaryScore = 0;
    let secondaryScore = 0;
    if (Array.isArray(entry.key)) {
        numberOfPrimaryKeys = entry.key.length;
        for (const key of entry.key) {
            if (matchKeys(bufferState, key, entry)) {
                primaryScore++;
            }
        }
    }
    if (Array.isArray(entry.keysecondary)) {
        numberOfSecondaryKeys = entry.keysecondary.length;
        for (const key of entry.keysecondary) {
            if (matchKeys(bufferState, key, entry)) {
                secondaryScore++;
            }
        }
    }
    if (!numberOfPrimaryKeys) {
        return 0;
    }
    if (numberOfSecondaryKeys > 0) {
        switch (entry.selectiveLogic) {
            case world_info_logic.AND_ANY:
                return primaryScore + secondaryScore;
            case world_info_logic.AND_ALL:
                return secondaryScore === numberOfSecondaryKeys ? primaryScore + secondaryScore : primaryScore;
        }
    }
    return primaryScore;
}
function getEnabledLoreBooks(chara = true, global = true, persona = true, charaExtra = true, chat = true, onlyExisting = true) {
    let results = [];
    if (chara) {
        const charaWorld = characters[this_chid]?.data?.extensions?.world;
        if (charaWorld && !selected_world_info.includes(charaWorld))
            results.push(charaWorld);
        for (const member of getGroupMembers()) {
            const world = member?.data?.extensions?.world;
            if (world && !selected_world_info.includes(world))
                results.push(world);
        }
    }
    if (global) {
        for (const world of selected_world_info) {
            if (world)
                results.push(world);
        }
    }
    if (persona) {
        const chatWorld = chat_metadata[METADATA_KEY];
        const personaWorld = power_user.persona_description_lorebook;
        if (personaWorld && personaWorld !== chatWorld && !selected_world_info.includes(personaWorld))
            results.push(personaWorld);
    }
    if (charaExtra) {
        const fileName = getCharaFilename(this_chid);
        if (fileName) {
            const extraCharLore = world_info.charLore?.find((e) => e.name === fileName);
            if (extraCharLore && Array.isArray(extraCharLore.extraBooks)) {
                const primaryBook = characters[this_chid]?.data?.extensions?.world;
                for (const book of extraCharLore.extraBooks) {
                    if (book && book !== primaryBook && !selected_world_info.includes(book))
                        results.push(book);
                }
            }
        }
        for (const member of getGroupMembers()) {
            const chid = characters.findIndex(ch => ch.avatar === member.avatar);
            const file = getCharaFilename(chid);
            if (file) {
                const extraCharLore = world_info.charLore?.find((e) => e.name === file);
                if (extraCharLore && Array.isArray(extraCharLore.extraBooks)) {
                    const primaryBook = member?.data?.extensions?.world;
                    for (const book of extraCharLore.extraBooks) {
                        if (book && book !== primaryBook && !selected_world_info.includes(book))
                            results.push(book);
                    }
                }
            }
        }
    }
    if (chat) {
        const chatWorld = chat_metadata[METADATA_KEY];
        if (chatWorld && !selected_world_info.includes(chatWorld))
            results.push(chatWorld);
    }
    if (onlyExisting)
        return results.filter(e => e && world_names.includes(e));
    return results;
}
async function getEnabledWorldInfoEntries(chara = true, global = true, persona = true, charaExtra = true, chat = true, onlyExisting = true) {
    let results = [];
    const lorebooks = getEnabledLoreBooks(chara, global, persona, charaExtra, chat, onlyExisting);
    for (const book of lorebooks) {
        const worldInfo = await getWorldInfoEntries(book);
        if (worldInfo?.length > 0) {
            results = results.concat(worldInfo);
        }
    }
    return results.sort(getWorldInfoSorter(results));
}
const DEPTH_MAPPING = {
    [world_info_position.before]: 4,
    [world_info_position.after]: 3,
    [world_info_position.EMTop]: 2,
    [world_info_position.EMBottom]: 1,
    [world_info_position.ANTop]: 1,
    [world_info_position.ANBottom]: -1,
};
function getWorldInfoSorter(entries) {
    const top = Math.max(...entries.map(x => x.position === world_info_position.atDepth ? x.depth : 0));
    return (a, b) => worldInfoSorter(a, b, top);
}
function worldInfoSorter(a, b, top = DEFAULT_DEPTH) {
    function calcDepth(entry) {
        const offset = DEPTH_MAPPING[entry.position];
        if (offset == null)
            return entry.depth ?? DEFAULT_DEPTH;
        if (entry.position === world_info_position.ANTop || entry.position === world_info_position.ANBottom) {
            switch (chat_metadata.note_position) {
                case 0:
                case 2:
                    return offset + top + DEPTH_MAPPING[world_info_position.before] + 2;
                case 1:
                    return (chat_metadata.note_depth ?? DEFAULT_DEPTH) + (entry.depth ?? DEFAULT_DEPTH);
            }
        }
        return offset + top;
    }
    return calcDepth(b) - calcDepth(a) ||
        a.order - b.order ||
        b.uid - a.uid;
}
class WorldInfoDecorators {
    decorators = [];
    arguments = [];
    cleanContent = '';
    decoratorContent = '';
    entry;
    constructor(entry, override = false) {
        this.entry = entry;
        if (entry.decorators?.length) {
            this.decorators = structuredClone(entry.decorators);
            this.cleanContent = entry.content;
        }
        else {
            const [decorators, cleanContent] = parseDecorators(entry.content);
            this.decorators = decorators;
            this.cleanContent = cleanContent;
            if (override) {
                entry.decorators = this.decorators;
                entry.content = this.cleanContent;
            }
        }
        this.decoratorContent = this.decorators.join('\n');
        for (const i in this.decorators) {
            if (this.decorators[i].includes(' ')) {
                const firstSpaceIndex = this.decorators[i].indexOf(' ');
                this.arguments[i] = this.decorators[i].substring(firstSpaceIndex + 1);
                this.decorators[i] = this.decorators[i].substring(0, firstSpaceIndex);
            }
        }
    }
    get isSpecialEntry() {
        if (this.has('@@initial_variables') ||
            this.entry.comment.includes('[InitialVariables]') ||
            this.entry.comment.includes('@INJECT'))
            return true;
        if (this.has('@@only_preload'))
            return true;
        if (this.entry.comment.includes('[GENERATE:') ||
            this.entry.comment.includes('[RENDER:') ||
            this.has('@@generate_after') ||
            this.has('@@generate_before') ||
            this.has('@@render_after') ||
            this.has('@@render_before'))
            return true;
        return false;
    }
    get isPreloadEntry() {
        if (this.has('@@dont_preload'))
            return false;
        if (this.has('@@only_preload') || this.has('@@preload'))
            return true;
        if (settings.preload_only)
            return false;
        return !this.isSpecialEntry;
    }
    get isEnabled() {
        if (this.has('@@always_enabled'))
            return true;
        if (settings.invert_enabled && this.isSpecialEntry)
            return this.entry.disable;
        return !this.entry.disable;
    }
    get isPreprocessingEntry() {
        if (this.entry.comment.includes('[Preprocessing]'))
            return true;
        return this.has('@@preprocessing');
    }
    async isConditionFiltedEntry(env, options = {}) {
        const condition = this.decorators.indexOf('@@if');
        if (condition < 0)
            return false;
        return (await evalTemplateHandler(`<%- !!(${this.arguments[condition]}) %>`, env, `lore book condition ${this.entry.world}/${this.entry.comment}/${this.entry.uid}`, {
            ...options,
            options: {
                filename: `worldinfo/${this.entry.world}/${this.entry.uid}-${this.entry.comment}/condition`,
                cache: settings.cache_enabled === 1,
                ...(options.options ?? {}),
            }
        })) === 'false';
    }
    get isPrivateEntry() {
        return this.decorators.includes('@@private');
    }
    get isForceActivation() {
        return !this.decorators.includes('@@dont_activate') && this.decorators.includes('@@activate');
    }
    get isForceDeactivation() {
        return this.decorators.includes('@@dont_deactivate');
    }
    has(decorator) {
        if (!decorator)
            return false;
        return this.decorators.includes(decorator);
    }
}
function parseDecorators(content) {
    if (!content.startsWith('@@')) {
        return [[], content];
    }
    const decorators = [];
    let lineStart = 0;
    let fallbacked = false;
    while (lineStart < content.length) {
        if (!content.startsWith('@@', lineStart)) {
            break;
        }
        let lineEnd = content.indexOf('\n', lineStart);
        if (lineEnd === -1) {
            lineEnd = content.length;
        }
        let line = content.substring(lineStart, lineEnd);
        if (line.endsWith('\r')) {
            line = line.slice(0, -1);
        }
        const isEscaped = line.startsWith('@@@');
        if (isEscaped && !fallbacked) {
            break;
        }
        const candidate = isEscaped ? line.substring(1) : line;
        const spaceIndex = candidate.indexOf(' ');
        const base = spaceIndex !== -1 ? candidate.substring(0, spaceIndex) : candidate;
        if (KNOWN_DECORATORS.has(base)) {
            decorators.push(candidate);
            fallbacked = false;
        }
        else {
            fallbacked = true;
        }
        if (lineEnd === content.length) {
            lineStart = content.length;
            break;
        }
        lineStart = lineEnd + 1;
    }
    const newContent = content.slice(lineStart);
    return [decorators, newContent];
}
function convertJsonPointerToLodashPath(pointer) {
    if (typeof pointer !== 'string') {
        throw new Error('Path must be a string.');
    }
    if (pointer === '') {
        return [];
    }
    if (pointer.charAt(0) !== '/') {
        throw new Error('Invalid JSON Pointer: must start with "/".');
    }
    return pointer.substring(1).split('/').map(segment => {
        return segment.replace(/~1/g, '/').replace(/~0/g, '~');
    });
}
function jsonPatch(doc, patches) {
    const newDoc = _.cloneDeep(doc);
    for (const patch of patches) {
        const { op, path, value } = patch;
        const fromPath = patch.from ? convertJsonPointerToLodashPath(patch.from) : undefined;
        const lodashPath = convertJsonPointerToLodashPath(path);
        switch (op) {
            case 'set':
            case 'assign':
            case 'add':
            case 'replace': {
                const lastSegment = lodashPath[lodashPath.length - 1];
                if (lastSegment === '-') {
                    const parentPath = lodashPath.slice(0, -1);
                    const parent = _.get(newDoc, parentPath);
                    if (Array.isArray(parent)) {
                        parent.push(value);
                    }
                    else {
                        toastr.error(`Cannot push to a non-array value at path: ${parentPath.join('.')}`, 'JSON Patch');
                        break;
                    }
                }
                else {
                    _.set(newDoc, lodashPath, value);
                }
                break;
            }
            case 'remove': {
                if (!_.unset(newDoc, lodashPath)) {
                    toastr.warn(`Path "${path}" could not be removed.`, 'JSON Patch');
                }
                break;
            }
            case 'move': {
                const valueToMove = _.get(newDoc, fromPath);
                if (_.isUndefined(valueToMove)) {
                    toastr.error(`Cannot move from a non-existent path: "${patch.from}"`, 'JSON Patch');
                    break;
                }
                _.unset(newDoc, fromPath);
                _.set(newDoc, lodashPath, valueToMove);
                break;
            }
            case 'copy': {
                const valueToCopy = _.get(newDoc, fromPath);
                if (_.isUndefined(valueToCopy)) {
                    toastr.error(`Cannot copy from a non-existent path: "${patch.from}"`, 'JSON Patch');
                    break;
                }
                _.set(newDoc, lodashPath, valueToCopy);
                break;
            }
            case 'test': {
                const existingValue = _.get(newDoc, lodashPath);
                if (!_.isEqual(existingValue, value)) {
                    toastr.error(`Test failed: value at "${path}" is not equal to the provided value.`);
                    return doc;
                }
                break;
            }
            default:
                toastr.warning(`Unsupported patch operation: "${op}"`, 'JSON Patch');
        }
    }
    return newDoc;
}
function patchVariables(key, change, options = {}) {
    const doc = getVariable.call(this, key, options);
    const patch = jsonPatch(doc, typeof change === 'string' ? parseJSON(change) : change);
    return setVariable.call(this, key, patch, options);
}
function parseJSON(json) {
    return JSON.parse(jsonrepair(json));
}
let promptInjected = new Map();
let forceOutlet = false;
function injectPrompt(key, prompt, order = 100, sticky = 0, uid = '') {
    if (!promptInjected.has(key)) {
        promptInjected.set(key, new Map());
    }
    if (!uid)
        uid = hashString(`${key}#${prompt}`, 0xdeadbeef);
    promptInjected.get(key).set(uid, { prompt, order, sticky, uid: uid });
}
function getPromptsInjected(key, postprocess = [], outlet = forceOutlet) {
    if (outlet && postprocess.length <= 0)
        return `{{outletPromptsInjected:${key}}}`;
    if (outlet && postprocess.length)
        console.warn(`[Prompt Template] outlet with postprocess is not supported`);
    const innerMap = promptInjected.get(key);
    if (!innerMap) {
        return '';
    }
    let combinedPrompt = Array.from(innerMap.values())
        .sort((a, b) => a.order - b.order)
        .map(p => p.prompt)
        .join('\n');
    for (const pp of postprocess)
        combinedPrompt = combinedPrompt.replace(pp.search, pp.replace);
    return combinedPrompt;
}
function applyOutletPromptsInjected(content, recursion = world_info_max_recursion_steps + 1) {
    let result = content;
    for (let i = 0; i < recursion; i++) {
        if (!result.includes('{{outletPromptsInjected:'))
            break;
        result = result.replace(/\{\{outletPromptsInjected:(.+?)\}\}/g, (_, key) => getPromptsInjected(key));
    }
    return result;
}
function setForceOutlet(force = true) {
    forceOutlet = force;
}
function deactivatePromptInjection(count = 1) {
    for (const key of Array.from(promptInjected.keys())) {
        const innerMap = promptInjected.get(key);
        if (!innerMap) {
            continue;
        }
        const uuidsToRemove = [];
        for (const [uuid, promptObj] of innerMap.entries()) {
            const newSticky = promptObj.sticky - count;
            if (newSticky >= 0) {
                promptObj.sticky = newSticky;
            }
            else {
                uuidsToRemove.push(uuid);
            }
        }
        if (uuidsToRemove.length > 0) {
            if (uuidsToRemove.length === innerMap.size) {
                promptInjected.delete(key);
            }
            else {
                for (const uuid of uuidsToRemove) {
                    innerMap.delete(uuid);
                }
                if (innerMap.size === 0) {
                    promptInjected.delete(key);
                }
            }
        }
    }
}
function hasPromptsInjected(key) {
    return promptInjected.has(key);
}
const REGEX = {
    generateRegex: new Map(),
    messageRegex: new Map(),
};
function activateRegex(pattern, replace, opts = {}) {
    const uuid = opts.uuid || hashString(`${pattern}@${replace}`, 0x0baddead);
    if (opts.basic || (opts.basic == null && opts.message == null && opts.generate == null)) {
        if (typeof replace !== 'string') {
            throw new Error('Basic mode regexes must have a string replace value.');
        }
        const exist = extension_settings.regex.find(x => x.id === uuid);
        if (exist) {
            exist.findRegex = pattern instanceof RegExp ? `/${pattern.source}/${pattern.flags}` : pattern;
            exist.replaceString = replace;
            exist.placement = _.compact([
                opts.user ?? true ? 1 : 0,
                opts.assistant ?? true ? 2 : 0,
                opts.worldinfo ?? true ? 5 : 0,
                opts.reasoning ?? true ? 6 : 0,
            ]);
        }
        else {
            extension_settings.regex.push({
                id: uuid,
                scriptName: `\u200b${uuid}`,
                findRegex: pattern instanceof RegExp ? pattern.source : pattern,
                replaceString: replace,
                trimStrings: [],
                placement: _.compact([
                    opts.user ?? true ? 1 : 0,
                    opts.assistant ?? true ? 2 : 0,
                    opts.worldinfo ?? false ? 5 : 0,
                    opts.reasoning ?? true ? 6 : 0,
                ]),
                disabled: false,
                markdownOnly: false,
                promptOnly: true,
                runOnEdit: false,
                substituteRegex: 0,
                minDepth: opts.minDepth ?? NaN,
                maxDepth: opts.minDepth ?? NaN,
            });
        }
    }
    if (opts.generate) {
        REGEX.generateRegex.set(uuid, {
            search: pattern,
            replace,
            user: opts.user ?? true,
            assistant: opts.assistant ?? true,
            system: opts.system ?? true,
            worldinfo: opts.worldinfo ?? false,
            order: opts.order ?? 100,
            sticky: opts.sticky ?? 0,
        });
    }
    if (opts.message) {
        REGEX.messageRegex.set(uuid, {
            search: pattern,
            replace,
            user: opts.user ?? true,
            assistant: opts.assistant ?? true,
            system: opts.system ?? true,
            reasoning: opts.reasoning ?? false,
            worldinfo: opts.worldinfo ?? false,
            order: opts.order ?? 100,
            minDepth: opts.minDepth ?? NaN,
            maxDepth: opts.minDepth ?? NaN,
            before: opts.before ?? (opts.after ?? opts.html) == null,
            after: opts.after ?? false,
            html: opts.html ?? false,
            sticky: opts.sticky ?? 0,
        });
    }
}
function deactivateRegex(selector = {}, count = 1) {
    if (selector.uuid) {
        extension_settings.regex = extension_settings.regex.filter(x => x.id !== selector.uuid);
        const generate = REGEX.generateRegex.get(selector.uuid);
        if (generate) {
            generate.sticky -= count;
            if (generate.sticky <= 0)
                REGEX.generateRegex.delete(selector.uuid);
        }
        const message = REGEX.messageRegex.get(selector.uuid);
        if (message) {
            message.sticky -= count;
            if (message.sticky <= 0)
                REGEX.messageRegex.delete(selector.uuid);
        }
    }
    else {
        if (selector.basic)
            extension_settings.regex = extension_settings.regex.filter(x => !x.scriptName.startsWith('\u200b'));
        if (selector.generate) {
            for (const [uuid, regex] of Array.from(REGEX.generateRegex.entries())) {
                regex.sticky -= count;
                if (regex.sticky <= 0)
                    REGEX.generateRegex.delete(uuid);
            }
        }
        if (selector.message) {
            for (const [uuid, regex] of Array.from(REGEX.messageRegex.entries())) {
                regex.sticky -= count;
                if (regex.sticky <= 0)
                    REGEX.messageRegex.delete(uuid);
            }
        }
    }
}
function applyRegex(env, content, options = {}) {
    if (options.uuid) {
        const message = REGEX.messageRegex.get(options.uuid);
        if (message)
            content = content.replace(message.search, message.replace);
        const generate = REGEX.generateRegex.get(options.uuid);
        if (generate)
            content = content.replace(generate.search, generate.replace);
    }
    else {
        if (options.message) {
            for (const regex of Array.from(REGEX.messageRegex.values()).sort((a, b) => a.order - b.order)) {
                if (options.assistant && regex.assistant === false)
                    continue;
                if (options.user && regex.user === false)
                    continue;
                if (options.system && regex.system === false)
                    continue;
                if (options.reasoning && !regex.reasoning)
                    continue;
                if (options.worldinfo && !regex.worldinfo)
                    continue;
                if (options.before && !regex.before)
                    continue;
                if (options.after && !regex.after)
                    continue;
                if (options.html && !regex.html)
                    continue;
                if (Number.isSafeInteger(options.depth)) {
                    if (regex.minDepth >= -1 && options.depth < regex.minDepth)
                        continue;
                    if (regex.maxDepth >= 0 && options.depth > regex.maxDepth)
                        continue;
                }
                content = content.replace(regex.search, typeof regex.replace === 'function' ? regex.replace.bind(env) : regex.replace);
            }
        }
        if (options.generate) {
            for (const regex of Array.from(REGEX.generateRegex.values()).sort((a, b) => a.order - b.order)) {
                if (options.role === 'user' && regex.user === false)
                    continue;
                if (options.role === 'assistant' && regex.assistant === false)
                    continue;
                if (options.role === 'system' && regex.system === false)
                    continue;
                if (options.worldinfo && !regex.worldinfo)
                    continue;
                content = content.replace(regex.search, typeof regex.replace === 'function' ? regex.replace.bind(env) : regex.replace);
            }
        }
    }
    return content;
}

return {deepMergeZod,STATE,precacheVariables,setVariable,getVariable,removeVariable,insertVariable,increaseVariable,decreaseVariable,checkAndSave,findPreviousMessageVariables,clonePreviousMessage,dumpYamlWithSchema,setVariableSchema,activateWorldInfo,activateWorldInfoByKeywords,applyActivateWorldInfo,deactivateActivateWorldInfo,getActivatedWIEntries,getWorldInfoEntries,getWorldInfoComments,getWorldInfoEntry,getWorldInfoEntryContent,getWorldInfoActivatedEntries,selectActivatedEntries,getEnabledLoreBooks,getEnabledWorldInfoEntries,WorldInfoDecorators,parseDecorators,jsonPatch,patchVariables,parseJSON,injectPrompt,getPromptsInjected,applyOutletPromptsInjected,setForceOutlet,deactivatePromptInjection,hasPromptsInjected,activateRegex,deactivateRegex,applyRegex};
}
