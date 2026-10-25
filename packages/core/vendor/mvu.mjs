// 从 MVU 抽取并接入本项目上下文，修改日期 2026-10-25；来源与许可见 mvu-sources.json、LICENSE-MVU。
import _ from 'lodash';
import JSON5 from 'json5';
import { klona } from 'klona';
import * as math from 'mathjs';
import * as YAML from 'yaml';
import { jsonrepair } from 'jsonrepair';
export function createMvuEngine({eventEmit, substitudeMacros, getLorebookEntries, console = globalThis.console}) {
const tr = (key, parameters = {}) => key + ' ' + JSON.stringify(parameters);
const parseJson5 = JSON5.parse;
const toastr = { error: (...args) => { throw new Error(args.join(' ')); } };
function assertVWD(_flag, _v) { }

function isValueWithDescription(value) {
    return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string';
}

function isValueWithDescriptionStatData(value) {
    return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string';
}

function isArraySchema(value) {
    return value.type === 'array';
}

function isObjectSchema(value) {
    return value.type === 'object';
}

function isPrimitiveSchema(value) {
    return (value.type === 'string' ||
        value.type === 'number' ||
        value.type === 'boolean' ||
        value.type === 'any');
}

const exported_events = {
    //对外接口，外部可以通过 event 的形式，对 mvu 的分析操作进行调用。
    INVOKE_MVU_PROCESS: 'mag_invoke_mvu',
    //调用更新变量函数的事件。
    UPDATE_VARIABLE: 'mag_update_variable',
};

function isMvuData(variables) {
    return _.get(variables, 'stat_data') !== undefined && _.get(variables, 'schema') !== undefined;
}

const variable_events = {
    /** 新开聊天对变量初始化时触发的事件  */
    VARIABLE_INITIALIZED: 'mag_variable_initialized',
    /** 某轮变量更新开始时触发的事件 */
    VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
    /**
     * 某轮变量更新过程中, 对文本成功解析了所有更新命令时触发的事件
     *
     * @example
     * // 修复 gemini 在中文间加入的 '-'', 如将 '角色.络-络' 修复为 '角色.络络'
     * eventOn(Mvu.events.COMMAND_PARSED, commands => {
     *   commands.forEach(command => {
     *     command.args[0] = command.args[0].replace(/-/g, '');
     *   });
     * });
     *
     * @example
     * // 修复繁体字, 如将 '絡絡' 修复为 '络络'
     * eventOn(Mvu.events.COMMAND_PARSED, commands => {
     *   commands.forEach(command => {
     *     command.args[0] = command.args[0].replaceAll('絡絡', '络络');
     *   });
     * });
     *
     * @example
     * // 添加新的更新命令
     * eventOn(Mvu.events.COMMAND_PARSED, commands => {
     *   commands.push({
     *     type: 'set',
     *     full_match: `_.set('络络.好感度', 5)`,
     *     args: ['络络.好感度', 5],
     *     reason: '脚本强行更新',
     *   });
     * });
     */
    COMMAND_PARSED: 'mag_command_parsed',
    /**
     * 某轮变量更新结束时触发的事件
     *
     * @example
     * // 保持好感度不低于 0
     * eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, variables => {
     *   if (_.get(variables, 'stat_data.角色.络络.好感度') < 0) {
     *     _.set(variables, 'stat_data.角色.络络.好感度', 0);
     *   }
     * })
     *
     * @example
     * // 保持好感度增幅不超过 3
     * eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (variables, variables_before_update) => {
     *   const old_value = _.get(variables_before_update, 'stat_data.角色.络络.好感度');
     *   const new_value = _.get(variables, 'stat_data.角色.络络.好感度');
     *
     *   // 新的好感度必须在 旧好感度-3 和 旧好感度+3 之间
     *   _.set(variables, 'stat_data.角色.络络.好感度', _.clamp(new_value, old_value - 3, old_value + 3));
     * });
     */
    VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    /** 即将用更新后的变量更新楼层时触发的事件  */
    BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
    /** @deprecated */
    SINGLE_VARIABLE_UPDATED: 'mag_variable_updated',
};

const UPDATE_REGEX = /\[mvu_update\]/i;

const PLOT_REGEX = /\[mvu_plot\]/i;

const EXTENSIBLE_MARKER = '$__META_EXTENSIBLE__$';

function generateSchema(data, oldSchemaNode, parentRecursiveExtensible = false) {
    // @ts-expect-error hack for mvu zod
    if (oldSchemaNode === '没有用别管这个') {
        return { type: 'any' };
    }
    if (Array.isArray(data)) {
        let isExtensible = false;
        let isRecursiveExtensible = parentRecursiveExtensible;
        let oldElementType;
        let template;
        // 使用类型守卫检查 oldSchemaNode 是否为 ArraySchemaNode
        if (oldSchemaNode) {
            if (isArraySchema(oldSchemaNode)) {
                isExtensible = oldSchemaNode.extensible === true;
                isRecursiveExtensible =
                    oldSchemaNode.recursiveExtensible === true || parentRecursiveExtensible;
                oldElementType = oldSchemaNode.elementType;
                template = oldSchemaNode.template;
            }
            else {
                console.error(`Type mismatch: expected array schema but got ${oldSchemaNode.type} at path`);
            }
        }
        // 检查是否有只包含 $meta 的元素
        const metaElementIndex = data.findIndex(item => _.isObject(item) &&
            !_.isDate(item) &&
            '$arrayMeta' in item &&
            '$meta' in item &&
            item['$arrayMeta'] === true);
        if (metaElementIndex !== -1) {
            const metaElement = data[metaElementIndex];
            // 从 $meta 中提取数组的元数据
            if (metaElement.$meta.extensible !== undefined) {
                isExtensible = metaElement.$meta.extensible;
            }
            if (metaElement.$meta.template !== undefined) {
                template = metaElement.$meta.template;
            }
            // 从数组中移除这个元数据元素
            data.splice(metaElementIndex, 1);
            console.log(`Array metadata element found and processed.`);
        }
        // 检查并处理魔法字符串
        const markerIndex = data.indexOf(EXTENSIBLE_MARKER);
        if (markerIndex > -1) {
            isExtensible = true;
            // 从数组中移除标记，以免影响后续的类型推断
            data.splice(markerIndex, 1);
            console.log(`Extensible marker found and removed from an array.`);
        }
        const schema_node = {
            type: 'array',
            extensible: isExtensible || parentRecursiveExtensible,
            recursiveExtensible: isRecursiveExtensible,
            elementType: data.length > 0
                ? generateSchema(data[0], oldElementType, isRecursiveExtensible)
                : { type: 'any' },
        };
        if (template !== undefined) {
            schema_node.template = template;
        }
        return schema_node;
    }
    if (_.isObject(data) && !_.isDate(data)) {
        const typedData = data; // 类型断言
        // 使用类型守卫检查 oldSchemaNode 是否为 ObjectSchemaNode
        let oldExtensible = false;
        let oldRecursiveExtensible = parentRecursiveExtensible;
        let oldProperties;
        if (oldSchemaNode) {
            if (isObjectSchema(oldSchemaNode)) {
                oldExtensible = oldSchemaNode.extensible === true;
                oldRecursiveExtensible =
                    oldSchemaNode.recursiveExtensible === true || parentRecursiveExtensible;
                oldProperties = oldSchemaNode.properties;
            }
            else {
                console.error(`Type mismatch: expected object schema but got ${oldSchemaNode.type} at path`);
            }
        }
        const schemaNode = {
            type: 'object',
            properties: {},
            // 默认不可扩展，但检查旧 schema、$meta.extensible 或 parentRecursiveExtensible
            extensible: oldExtensible ||
                typedData.$meta?.extensible === true ||
                typedData.$meta?.recursiveExtensible === true ||
                parentRecursiveExtensible,
            recursiveExtensible: oldRecursiveExtensible || typedData.$meta?.recursiveExtensible === true,
        };
        // 处理 template
        if (typedData.$meta?.template !== undefined) {
            schemaNode.template = typedData.$meta.template;
        }
        else if (oldSchemaNode && isObjectSchema(oldSchemaNode) && oldSchemaNode.template) {
            schemaNode.template = oldSchemaNode.template;
        }
        // 暂存父节点的 $meta，以便在循环中使用
        const parentMeta = typedData.$meta;
        // 从 $meta 中读取信息后，将其从数据中移除，避免污染
        if (typedData.$meta) {
            delete typedData.$meta;
        }
        for (const key in data) {
            const oldChildNode = oldProperties?.[key];
            // 传递当前节点的 recursiveExtensible（如果存在）或父节点的 recursiveExtensible
            // 但如果当前节点明确设置 extensible: false, 则停止递归扩展
            const childRecursiveExtensible = schemaNode.extensible !== false && schemaNode.recursiveExtensible;
            const childSchema = generateSchema(typedData[key], oldChildNode, childRecursiveExtensible);
            // 一个属性是否必需？
            // 1. 默认值: 如果父节点可扩展，子节点默认为可选；否则为必需。
            let isRequired = !schemaNode.extensible;
            // 2. 覆盖规则: 检查父元数据中的 'required' 数组。
            //    如果父节点的 $meta.required 是一个数组，并且当前 key 在这个数组里，
            //    则无论默认值是什么，都强制覆盖为必需。
            if (Array.isArray(parentMeta?.required) && parentMeta.required.includes(key)) {
                isRequired = true;
            }
            // 3. 检查旧 schema 的设置，作为最后的参考
            if (oldChildNode?.required === false) {
                // 如果旧 schema 明确说这个是可选的，那么以这个为准
                isRequired = false;
            }
            else if (oldChildNode?.required === true) {
                isRequired = true;
            }
            schemaNode.properties[key] = {
                ...childSchema,
                required: isRequired,
            };
        }
        return schemaNode;
    }
    // 处理原始类型
    const dataType = typeof data;
    if (dataType === 'string' || dataType === 'number' || dataType === 'boolean') {
        return { type: dataType };
    }
    // 对于其他类型（function, symbol, bigint, undefined 等），默认返回 'any'
    return { type: 'any' };
}

function getSchemaForPath(schema, path) {
    if (!path || !schema) {
        return schema || null;
    }
    // 将 lodash 路径字符串转换为段数组，例如 'a.b[0].c' -> ['a', 'b', '0', 'c']
    const pathSegments = _.toPath(path);
    let currentSchema = schema;
    for (const segment of pathSegments) {
        if (!currentSchema)
            return null;
        // 如果 segment 是数字（数组索引），则移动到 elementType
        if (/^\d+$/.test(segment)) {
            if (isArraySchema(currentSchema)) {
                currentSchema = currentSchema.elementType;
            }
            else {
                return null; // 路径试图索引一个非数组或无 elementType 的 schema
            }
        }
        else if (isObjectSchema(currentSchema) && currentSchema.properties[segment]) {
            // 否则，作为对象属性访问
            const property = currentSchema.properties[segment];
            currentSchema = property;
        }
        else {
            return null; // 路径中的键在 schema 中不存在
        }
    }
    return currentSchema;
}

function reconcileAndApplySchema(variables) {
    console.log('Reconciling schema with current data state...');
    // 1. 深拷贝数据，以防 generateSchema 修改原始数据（例如删除 $meta）
    const currentDataClone = klona(variables.stat_data);
    // 2. 使用改进后的 generateSchema 生成一个与当前数据完全匹配的新 Schema，
    //    并在此过程中从旧 Schema 继承元数据。
    const newSchema = generateSchema(currentDataClone, variables.schema);
    // 3. 直接用新 Schema 替换旧 Schema
    // stat_data 的根节点应该始终是对象，所以生成的 schema 也应该是 ObjectSchemaNode
    if (!isObjectSchema(newSchema)) {
        return;
    }
    // 保留 RootAdditionalProps
    const newSchemaWithProps = newSchema;
    if (variables.schema?.strictTemplate !== undefined) {
        newSchemaWithProps.strictTemplate = variables.schema.strictTemplate;
    }
    if (variables.schema?.strictSet !== undefined) {
        newSchemaWithProps.strictSet = variables.schema.strictSet;
    }
    if (variables.schema?.concatTemplateArray !== undefined) {
        newSchemaWithProps.concatTemplateArray = variables.schema.concatTemplateArray;
    }
    if (_.has(variables.stat_data, '$meta.strictTemplate'))
        newSchemaWithProps.strictTemplate = variables.stat_data['$meta']?.strictTemplate;
    if (_.has(variables.stat_data, '$meta.strictSet'))
        newSchemaWithProps.strictSet = variables.stat_data['$meta']?.strictSet;
    if (_.has(variables.stat_data, '$meta.concatTemplateArray'))
        newSchemaWithProps.concatTemplateArray = variables.stat_data['$meta']
            ?.concatTemplateArray;
    variables.schema = newSchemaWithProps;
    console.log('Schema reconciliation complete.');
}

function isMetaCarrier(value) {
    return _.isObject(value) && !_.isDate(value);
}

function cleanUpMetadata(data) {
    // 如果是数组，移除魔法字符串和只包含 $meta 的元素，并递归
    if (Array.isArray(data)) {
        let i = data.length;
        while (i--) {
            if (data[i] === EXTENSIBLE_MARKER) {
                data.splice(i, 1);
            }
            else if (_.isObject(data[i]) &&
                !_.isDate(data[i]) &&
                '$arrayMeta' in data[i] &&
                '$meta' in data[i] &&
                data[i]['$arrayMeta'] === true) {
                // 移除只包含 $meta & $arrayMeta 的元素
                data.splice(i, 1);
            }
            else {
                // 对数组中的其他元素（可能是对象或数组）进行递归清理
                cleanUpMetadata(data[i]);
            }
        }
    }
    // 如果是对象，移除 $meta 并递归
    else if (isMetaCarrier(data)) {
        // 清除自身 $meta
        delete data.$meta;
        // 递归
        for (const key in data) {
            cleanUpMetadata(data[key]);
        }
    }
}

function correctlyMerge(lhs, rhs) {
    return _.mergeWith(lhs, rhs, (_lhs, rhs) => (_.isArray(rhs) ? rhs : undefined));
}

function literalYamlify(value) {
    return YAML.stringify(value, { blockQuote: 'literal' });
}

function parseString(content) {
    const json_first = /^[[{]/s.test(content.trimStart());
    try {
        if (json_first) {
            throw Error(`expected error`);
        }
        return YAML.parseDocument(content, { merge: true }).toJS();
    }
    catch (yaml_error1) {
        try {
            // eslint-disable-next-line import-x/no-named-as-default-member
            return JSON5.parse(content);
        }
        catch (json5_error) {
            try {
                return JSON.parse(jsonrepair(content));
            }
            catch (json_error) {
                try {
                    if (!json_first) {
                        throw Error(`expected error`);
                    }
                    return YAML.parseDocument(content, { merge: true }).toJS();
                }
                catch (yaml_error2) {
                    const toError = (error) => error instanceof Error
                        ? `${error.stack ? error.stack : error.message}`
                        : String(error);
                    throw new Error(literalYamlify({
                        [tr('runtime.parseString.invalidFormat')]: {
                            [tr('runtime.parseString.content')]: content,
                            [tr('runtime.parseString.yamlError')]: toError(json_first ? yaml_error2 : yaml_error1),
                            [tr('runtime.parseString.json5Error')]: toError(json5_error),
                            [tr('runtime.parseString.jsonError')]: toError(json_error),
                        },
                    }));
                }
            }
        }
    }
}

function isJsonPatch(patch) {
    if (!Array.isArray(patch)) {
        return false;
    }
    // An empty array is a valid patch.
    if (patch.length === 0) {
        return true;
    }
    return patch.every(op => _.isPlainObject(op) &&
        typeof op.op === 'string' &&
        (typeof op.path === 'string' || (op.op === 'move' && typeof op.to === 'string')));
}

const INCOMPLETE_PATCH_MARKER = '<!-- mvu:discard-incomplete-json-patch -->';

function scanUpdateMarkup(input) {
    // 通过等长空格屏蔽数据而不删除字符，让两个扫描视图与原文共用切片偏移。
    const structural = input.split('');
    const visible = input.split('');
    const tokens = [];
    const ignored = [];
    let mode;
    let pendingData = true;
    let quote = '';
    let escaped = false;
    let blockComment = false;
    let scalarIndent;
    let lineStart = 0;
    let markupDepth = 0;
    const hasExplicitUpdate = /<(?:updatevariable|variableupdate|update)\b[^>]*>/i.test(input);
    /** 屏蔽半开区间并保留换行；hide 同时从可见负载中隐藏思考区内容。 */
    const mask = (start, end, hide = false) => {
        for (let i = start; i < end; i++) {
            if (input[i] !== '\n' && input[i] !== '\r') {
                structural[i] = ' ';
                if (hide)
                    visible[i] = ' ';
            }
        }
    };
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (i === lineStart && pendingData && !ignored.length) {
            const first = input.slice(i).trimStart();
            if (first.startsWith('[') || first.startsWith('{') || /^(?:\/\/|\/\*|_\.)/.test(first))
                mode = 'json';
            else if (/^(?:-(?:\s|$)|#|[\w]+\s*:)/.test(first))
                mode = 'yaml';
        }
        if (i === lineStart && mode === 'yaml' && !quote && !ignored.length) {
            const lineEnd = input.indexOf('\n', i) < 0 ? input.length : input.indexOf('\n', i);
            const line = input.slice(i, lineEnd).replace(/\r$/, '');
            const indent = line.match(/^\s*/)?.[0].length ?? 0;
            // YAML 块标量内的标签属于文本，直到缩进退回标量声明所在层级才恢复标签识别。
            if (scalarIndent !== undefined) {
                if (!line.trim() || indent > scalarIndent) {
                    mask(i, lineEnd);
                    i = lineEnd;
                    lineStart = lineEnd + 1;
                    continue;
                }
                scalarIndent = undefined;
            }
            if (/^\s*(?:-\s+)?[^#\r\n]*:\s*[|>](?:[+-]?[1-9]?|[1-9][+-]?)\s*(?:#.*)?$/.test(line)) {
                scalarIndent = indent + (line.trimStart().startsWith('- ') ? 2 : 0);
                pendingData = false;
                mask(i, lineEnd);
                i = lineEnd;
                lineStart = lineEnd + 1;
                continue;
            }
        }
        if (char === '\n')
            lineStart = i + 1;
        // 用栈跟踪嵌套思考标签；其中的补丁示例不能成为实际更新块。
        if (ignored.length) {
            const tag = input
                .slice(i)
                .match(/^<(\/?)\s*(think|thinking|reasoning|analysis|analyze)\b[^>]*>/i);
            if (tag) {
                if (tag[1] && tag[2].toLowerCase() === ignored.at(-1))
                    ignored.pop();
                else if (!tag[1])
                    ignored.push(tag[2].toLowerCase());
                mask(i, i + tag[0].length, true);
                i += tag[0].length - 1;
                if (!ignored.length)
                    pendingData = true;
            }
            else
                mask(i, i + 1, true);
            continue;
        }
        // 字符串中的闭合标签不能截断补丁，同时兼容 JSON 转义和 YAML 单引号双写。
        if (quote) {
            mask(i, i + 1);
            if (escaped)
                escaped = false;
            else if (char === '\\' && (mode !== 'yaml' || quote === '"'))
                escaped = true;
            else if (char === quote) {
                if (mode === 'yaml' && quote === "'" && input[i + 1] === "'") {
                    mask(i + 1, i + 2);
                    i++;
                }
                else
                    quote = '';
            }
            continue;
        }
        if (blockComment) {
            mask(i, i + 1);
            if (char === '*' && input[i + 1] === '/') {
                mask(i + 1, i + 2);
                i++;
                blockComment = false;
            }
            continue;
        }
        if (char === '<') {
            const tag = input
                .slice(i)
                .match(/^<(\/?)\s*(updatevariable|variableupdate|update|json_?patch|think|thinking|reasoning|analysis|analyze)\b[^>]*>/i);
            if (tag) {
                const name = tag[2].toLowerCase();
                if (/^(think|thinking|reasoning|analysis|analyze)$/.test(name)) {
                    if (!tag[1])
                        ignored.push(name);
                    mask(i, i + tag[0].length, true);
                }
                else {
                    markupDepth = Math.max(0, markupDepth + (tag[1] ? -1 : 1));
                    tokens.push({
                        name: /^json/.test(name) ? 'patch' : 'update',
                        closing: !!tag[1],
                        start: i,
                        end: i + tag[0].length,
                    });
                    mode = undefined;
                    scalarIndent = undefined;
                    pendingData = !tag[1];
                }
                i += tag[0].length - 1;
                continue;
            }
        }
        if (pendingData && !/\s/.test(char)) {
            if (input.startsWith('```', i)) {
                const end = input.indexOf('\n', i);
                if (end >= 0) {
                    i = end;
                    lineStart = end + 1;
                    continue;
                }
            }
            mode =
                char === '[' || char === '{' || input.startsWith('_.', i)
                    ? 'json'
                    : /^-(?:\s|$)/.test(input.slice(i, i + 2)) || /^[\w]+\s*:/.test(input.slice(i))
                        ? 'yaml'
                        : mode;
            pendingData = false;
        }
        // 有显式更新块时，块外单词中的撇号不是字符串起点，不能吞掉后面的块。
        // 块内的数据字符串及没有更新包装的输入仍沿用原有规则。
        const proseApostrophe = hasExplicitUpdate &&
            markupDepth === 0 &&
            char === "'" &&
            /[\p{L}\p{N}]/u.test(input[i - 1] ?? '');
        if (mode && (char === '"' || char === "'") && !proseApostrophe) {
            quote = char;
            mask(i, i + 1);
        }
        else if (mode === 'json' && input.startsWith('/*', i)) {
            blockComment = true;
            mask(i, i + 2);
            i++;
        }
        else if ((mode === 'json' && input.startsWith('//', i)) ||
            (mode === 'yaml' && char === '#' && (i === lineStart || /\s/.test(input[i - 1])))) {
            const end = input.indexOf('\n', i) < 0 ? input.length : input.indexOf('\n', i);
            mask(i, end);
            i = end - 1;
        }
        else if (mode === 'yaml' && char === ':' && /\s/.test(input[i + 1] ?? '')) {
            const rest = input.slice(i + 1).match(/^[ \t]+([^\s"'[{|>#\r\n][^\r\n]*)/);
            if (rest) {
                // YAML 普通标量允许包含类 XML 文本，冒号后的值不能误识别为结构标签。
                mask(i + 1, i + 1 + rest[0].length);
                i += rest[0].length;
            }
        }
    }
    return {
        structural: structural.join(''),
        visible: visible.join(''),
        tokens,
        tail: { quote, blockComment, reasoning: ignored },
    };
}

function findUpdateMarkupBlocks(input, kind) {
    const stack = [];
    const blocks = [];
    for (const token of scanUpdateMarkup(input).tokens) {
        if (token.name !== kind)
            continue;
        if (!token.closing)
            stack.push({ start: token.start, contentStart: token.end });
        else {
            const opening = stack.pop();
            if (opening) {
                blocks.push({
                    ...opening,
                    contentEnd: token.start,
                    end: token.end,
                    closed: true,
                    ...(kind === 'patch' && input.startsWith(INCOMPLETE_PATCH_MARKER, token.end)
                        ? { discarded: true }
                        : {}),
                });
            }
        }
    }
    // 保留未闭合块供调用方决定兼容或拒绝，避免扫描阶段默默丢失截断回复。
    for (const opening of stack)
        blocks.push({ ...opening, contentEnd: input.length, end: input.length, closed: false });
    return blocks.sort((a, b) => a.start - b.start);
}

function closeUpdateMarkup(input) {
    // 先加换行结束 // 和 YAML # 行注释，也消费字符串末尾的反斜杠转义。
    const scanned = scanUpdateMarkup(`${input}\n`);
    let suffix = '\n';
    if (scanned.tail.quote)
        suffix += scanned.tail.quote + '\n';
    if (scanned.tail.blockComment)
        suffix += '*/\n';
    for (const name of [...scanned.tail.reasoning].reverse())
        suffix += `</${name}>\n`;
    const openings = [];
    for (const token of scanned.tokens) {
        if (!token.closing)
            openings.push(token);
        else {
            // 与 findUpdateMarkupBlocks 一致，按兼容标签类别配对，不把数据中的标签当作结构。
            const index = openings.findLastIndex(opening => opening.name === token.name);
            if (index >= 0)
                openings.splice(index, 1);
        }
    }
    const endings = openings.map(opening => {
        const tag = input.slice(opening.start, opening.end).match(/^<\s*([^\s/>]+)/)[1];
        // 只补标签会让 parseString 将旧残缺内容修复成命令；显式标记继续忽略该旧块。
        const marker = opening.name === 'patch' ? INCOMPLETE_PATCH_MARKER : '';
        return { start: opening.start, text: `</${tag}>${marker}\n` };
    });
    // 围栏只在未被屏蔽的行上识别，避免补丁字符串、YAML 块标量或思考区里的 ``` 干扰。
    // 把真实标签视为行边界，兼容 <JSONPatch>```json 和 ```</JSONPatch>，同时保留原文偏移。
    const fence_view = scanned.structural.split('');
    for (const token of scanned.tokens)
        fence_view.fill('\n', token.start, token.end);
    let fence;
    for (const match of fence_view.join('').matchAll(/^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)$/gm)) {
        if (!fence)
            fence = { start: match.index, delimiter: match[1] };
        else if (match[1][0] === fence.delimiter[0] &&
            match[1].length >= fence.delimiter.length &&
            !match[2].trim())
            fence = undefined;
    }
    if (fence)
        endings.push({ start: fence.start, text: `${fence.delimiter}\n` });
    // 补丁内的围栏先于补丁闭合，包住整个更新块的外层围栏则最后闭合。
    for (const ending of endings.sort((a, b) => b.start - a.start))
        suffix += ending.text;
    return suffix;
}

function cleanStructuredUpdate(input) {
    return input
        .trim()
        .replace(/^```(?:json5?|ya?ml)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

function parseStructuredUpdate(input) {
    const content = cleanStructuredUpdate(input);
    try {
        // YAML 可能把以 // 或 /* 开头的合法 JSON5 当成普通字符串，不能优先接受该结果。
        return parseJson5(content);
    }
    catch {
        return parseString(content);
    }
}

function isJsonSafe(value, ancestors = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return true;
    if (typeof value === 'number')
        return Number.isFinite(value);
    if (!Array.isArray(value) && !_.isPlainObject(value))
        return false;
    if (ancestors.has(value))
        return false;
    ancestors.add(value);
    const safe = Object.values(value).every(child => isJsonSafe(child, ancestors));
    // 仅禁止当前祖先链上的循环；同一个对象被不同分支共享仍然可以序列化。
    ancestors.delete(value);
    return safe;
}

function createReadOnlyMathNamespace(source, names) {
    // mathjs deliberately rejects property access on null-prototype objects. A frozen ordinary
    // object is still isolated from the host namespace and keeps `Math.floor`/`math.pow` syntax.
    const namespace = {};
    for (const name of names) {
        const value = source[name];
        namespace[name] = typeof value === 'function' ? value.bind(source) : value;
    }
    return Object.freeze(namespace);
}

const SAFE_JAVASCRIPT_MATH = createReadOnlyMathNamespace(Math, Object.getOwnPropertyNames(Math));

const SAFE_MATHJS_NAMESPACE = createReadOnlyMathNamespace(math, [
    'abs',
    'acos',
    'acosh',
    'asin',
    'asinh',
    'atan',
    'atan2',
    'atanh',
    'ceil',
    'cos',
    'cosh',
    'cube',
    'e',
    'exp',
    'expm1',
    'floor',
    'gcd',
    'hypot',
    'lcm',
    'log',
    'log10',
    'log1p',
    'log2',
    'max',
    'mean',
    'median',
    'min',
    'mod',
    'nthRoot',
    'pi',
    'pow',
    'prod',
    'round',
    'sign',
    'sin',
    'sinh',
    'sqrt',
    'square',
    'std',
    'sum',
    'tan',
    'tanh',
    'tau',
    'variance',
]);

const REUSABLE_MATH_FUNCTIONS = new Set([
    ...Object.keys(SAFE_MATHJS_NAMESPACE).filter(name => typeof SAFE_MATHJS_NAMESPACE[name] === 'function'),
    'complex',
    'det',
    'matrix',
    'number',
    'unit',
]);

let reusable_math;

function isReadOnlyMathAccessor(node) {
    const property = node.index.dimensions[0];
    if (!math.isSymbolNode(node.object) ||
        node.index.dimensions.length !== 1 ||
        !math.isConstantNode(property) ||
        typeof property.value !== 'string') {
        return false;
    }
    const namespace = node.object.name === 'Math'
        ? SAFE_JAVASCRIPT_MATH
        : node.object.name === 'math'
            ? SAFE_MATHJS_NAMESPACE
            : undefined;
    return namespace !== undefined && Object.hasOwn(namespace, property.value);
}

function canReuseMathInstance(expression) {
    return (expression.filter(node => {
        if (math.isAssignmentNode(node) || math.isFunctionAssignmentNode(node)) {
            return true;
        }
        if (math.isAccessorNode(node)) {
            return !isReadOnlyMathAccessor(node);
        }
        if (math.isFunctionNode(node)) {
            return math.isSymbolNode(node.fn)
                ? !REUSABLE_MATH_FUNCTIONS.has(node.fn.name)
                : !math.isAccessorNode(node.fn) || !isReadOnlyMathAccessor(node.fn);
        }
        return false;
    }).length === 0);
}

function trimQuotesAndBackslashes(str) {
    if (!_.isString(str))
        return str;
    // Regular expression to match backslashes and quotes (including backticks) at the beginning and end
    return str.replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/, '$1');
}

function applyTemplate(value, template, strict_array_cast = false, array_merge_concat = true) {
    // 如果没有模板，直接返回原值
    if (!template) {
        return value;
    }
    // 检查类型是否匹配
    const value_is_object = _.isObject(value) && !Array.isArray(value) && !_.isDate(value);
    const value_is_array = Array.isArray(value);
    const template_is_array = Array.isArray(template);
    if (value_is_object && !template_is_array) {
        // value 是对象，template 是 StatData（对象）
        // 先应用模板，再应用值，确保值的优先级更高
        return _.merge({}, template, value);
    }
    else if (value_is_array && template_is_array) {
        // 都是数组，进行合并
        if (array_merge_concat)
            return _.concat(value, template);
        return _.merge([], template, value);
    }
    else if (((value_is_object || value_is_array) && template_is_array !== value_is_array) ||
        (!value_is_object && !value_is_array && _.isObject(template) && !Array.isArray(template))) {
        // 类型不匹配
        console.error(`Template type mismatch: template is ${template_is_array ? 'array' : 'object'}, but value is ${value_is_array ? 'array' : 'object'}. Skipping template merge.`);
        return value;
    }
    else if (!value_is_object && !value_is_array && template_is_array) {
        // 特殊情况：值是原始类型（字面量），模板是数组
        // 当作 [value] 进行数组的合并
        if (strict_array_cast)
            //严格模式不提供 primitive type -> [primitive type] 的转换
            return value;
        if (array_merge_concat)
            return _.concat([value], template);
        return _.merge([], template, [value]);
    }
    else {
        // 其他情况：值是原始类型，模板不是数组，不应用模板
        return value;
    }
}

function parseCommandValue(valStr) {
    if (typeof valStr !== 'string')
        return valStr;
    const trimmed = valStr.trim();
    // 检查布尔值/null/undefined
    if (trimmed === 'true')
        return true;
    if (trimmed === 'false')
        return false;
    if (trimmed === 'null')
        return null;
    if (trimmed === 'undefined')
        return undefined;
    try {
        // 如果字符串能被 JSON.parse 解析，说明它是一个标准格式，直接返回解析结果
        return JSON.parse(trimmed);
    }
    catch (e) {
        // Accept relaxed data literals without evaluating model-controlled JavaScript.
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                // eslint-disable-next-line import-x/no-named-as-default-member
                const result = JSON5.parse(trimmed);
                if (_.isObject(result) || Array.isArray(result)) {
                    return result;
                }
            }
            catch (err) {
                // 如果解析失败，说明它可能是一个未加引号的字符串或数学表达式，继续往下走
            }
        }
    }
    // 单引号文本提前走原有 YAML 路径，保留反斜杠和双单引号的语义，不初始化数学库。
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        try {
            return YAML.parse(trimmed);
        }
        catch {
            // 仍可能是含字符串操作数的数学表达式，继续尝试求值。
        }
    }
    // 如果代码走到这里，说明 trimmed 是一个未加引号的字符串，例如：
    // 'hello_world', '10 + 2', 'sqrt(16)'
    try {
        const evaluator = (reusable_math ??= math.create(math.all));
        const expression = evaluator.parse(trimmed);
        // 创建一个 scope 对象，将多种数学库/对象注入到 mathjs 的执行环境中，
        // 以便统一处理不同风格的数学表达式。
        const scope = {
            // 支持 JavaScript 标准的 Math 对象 (e.g., Math.sqrt(), Math.PI)
            Math: SAFE_JAVASCRIPT_MATH,
            // 支持 Python 风格的 math 库用法 (e.g., math.sqrt(), math.pi)，
            // 这在 LLM 生成的代码中很常见。
            math: SAFE_MATHJS_NAMESPACE,
        };
        // 尝试使用 mathjs 进行数学求值
        // math.evaluate 对于无法识别为表达式的纯字符串会抛出错误
        const result = canReuseMathInstance(expression)
            ? expression.compile().evaluate(scope)
            : math.create(math.all).evaluate(trimmed, scope);
        // 如果结果是 mathjs 的复数或矩阵对象，则将其转换为字符串表示形式
        if (math.isComplex(result) || math.isMatrix(result)) {
            return result.toString();
        }
        // 避免将单个单词的字符串（mathjs可能将其识别为符号）作为 undefined 返回
        if (result === undefined && !/^[a-zA-Z_]+$/.test(trimmed)) {
            return trimmed; // 如果是 undefined 但不是一个简单的符号名，则可能是解析错误
        }
        if (result !== undefined) {
            // 使用 toPrecision 来处理浮点数精度造成的误差问题
            return parseFloat(result.toPrecision(12));
        }
    }
    catch (err) {
        // 如果 math.evaluate 失败，说明它不是一个有效的表达式，
        // 那么它就是一个普通的未加引号的字符串。
    }
    // 实验性功能，暂不启用
    // 尝试将字符串解析为日期对象，用于传入_.add直接以毫秒数更新时间，如 `_.add('当前时间', 10 * 60 * 1000);`
    // 此检查用于识别日期字符串（例如 "2024-01-01T12:00:00Z"）
    // `isNaN(Number(trimmed))`确保纯数字字符串（如 "12345"）不会被错误地解析为日期
    /*
    if (isNaN(Number(trimmed))) {
        const potentialDate = new Date(trimQuotesAndBackslashes(trimmed));
        if (!isNaN(potentialDate.getTime())) {
            return potentialDate;
        }
    }
    */
    try {
        // 尝试 YAML.parse
        return YAML.parse(trimmed);
    }
    catch (e) {
        /* empty */
    }
    // 最终，返回这个去除了首尾引号的字符串
    return trimQuotesAndBackslashes(valStr);
}

function pathSegmentsToLodashPath(pathSegments) {
    return pathSegments
        .map(segment => `["${segment.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
        .join('');
}

function jsonPatchPathToCommandPath(path) {
    if (!path)
        return '';
    const pathWithoutRoot = path.startsWith('/') ? path.substring(1) : path;
    const pathSegments = pathWithoutRoot
        .split('/')
        .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (pathSegments[0] === 'stat_data') pathSegments.shift();
    return pathSegmentsToLodashPath(pathSegments);
}

function extractJsonPatch(patch) {
    const translated_commands = [];
    for (const op of patch) {
        const path = jsonPatchPathToCommandPath(op.path ?? op.to);
        switch (op.op) {
            case 'replace':
                translated_commands.push({
                    type: 'set',
                    full_match: JSON.stringify(op),
                    args: [path, JSON.stringify(op.value)],
                    reason: 'json_patch',
                });
                break;
            case 'delta': {
                translated_commands.push({
                    type: 'add',
                    full_match: JSON.stringify(op),
                    args: [path, JSON.stringify(op.value)],
                    reason: 'json_patch',
                });
                break;
            }
            case 'insert':
            case 'add': {
                const pathParts = _.toPath(path);
                const lastPart = pathParts[pathParts.length - 1];
                const containerPath = pathSegmentsToLodashPath(pathParts.slice(0, -1));
                // 保留 JSON Patch 的 "-" 特殊 token，交给执行阶段结合目标集合类型解释。
                const keyOrIndexArg = /^\d+$/.test(lastPart) ? lastPart : JSON.stringify(lastPart);
                translated_commands.push({
                    type: 'insert',
                    full_match: JSON.stringify(op),
                    args: [containerPath, keyOrIndexArg, JSON.stringify(op.value)],
                    reason: 'json_patch',
                });
                break;
            }
            case 'remove':
                translated_commands.push({
                    type: 'delete',
                    full_match: JSON.stringify(op),
                    args: [path],
                    reason: 'json_patch',
                });
                break;
            case 'move':
                translated_commands.push({
                    type: 'move',
                    full_match: JSON.stringify(op),
                    args: [jsonPatchPathToCommandPath(op.from), path],
                    reason: 'json_patch',
                });
                break;
        }
    }
    return translated_commands;
}

function extractCommands(inputText) {
    // TODO: 应该按照消息中更新命令出现的顺序来排列 json_patch 和自定义命令
    const results = _.concat(findUpdateMarkupBlocks(inputText, 'patch')
        .filter(block => block.closed && !block.discarded)
        .map(block => ({
        index: block.start,
        string: cleanStructuredUpdate(inputText.slice(block.contentStart, block.contentEnd)),
    }))
        .flatMap(({ index, string }) => {
        try {
            const patch = parseString(string);
            {
                if (isJsonPatch(patch)) {
                    return extractJsonPatch(patch).map(command => ({
                        $index: index,
                        ...command,
                    }));
                }
            }
        }
        catch {
            /* ignore */
        }
        return [];
    }));
    // 用等长空格遮蔽补丁和思考区，保留原文偏移以读取真正命令的参数。
    // JSONPatch 中看似脚本的字符串是数据，不能再作为旧命令执行一次。
    const legacy_chars = scanUpdateMarkup(inputText).visible.split('');
    for (const block of findUpdateMarkupBlocks(inputText, 'patch')) {
        legacy_chars.fill(' ', block.start, block.end);
    }
    const legacy_text = legacy_chars.join('');
    let i = 0;
    while (i < inputText.length) {
        // 循环处理整个输入文本，直到找不到更多命令
        // 使用正则匹配 _.set(、_.assign(、_.remove( 或 _.add(，重构后支持多种命令
        const setMatch = legacy_text
            .substring(i)
            .match(/_\.(set|insert|assign|remove|unset|delete|add)\(/);
        if (!setMatch || setMatch.index === undefined) {
            // 没有找到匹配的命令，退出循环，防止无限循环
            break;
        }
        // 提取命令类型（set、assign、remove 或 add），并计算命令的起始位置
        const commandType = setMatch[1];
        const setStart = i + setMatch.index;
        // 计算开括号位置，用于后续提取参数
        const openParen = setStart + setMatch[0].length;
        // 使用 findMatchingCloseParen 查找匹配的闭括号，解决原正则匹配在嵌套结构（如 _.set('path', ['inner);'])）中提前结束的问题
        const closeParen = findMatchingCloseParen(inputText, openParen);
        if (closeParen === -1) {
            // 找不到闭括号，说明命令格式错误
            // 跳过此无效命令，并从开括号后继续搜索，以防无限循环
            i = openParen; // 从开括号后继续搜索
            continue; // 继续 while 循环，寻找下一个命令
        }
        // 检查闭括号后是否紧跟分号，确保命令语法完整，防止误解析字符串中的类似结构
        let endPos = closeParen + 1;
        if (endPos >= inputText.length || inputText[endPos] !== ';') {
            // 没有分号，命令无效，跳到闭括号后继续搜索，避免误解析
            i = closeParen + 1;
            continue;
        }
        endPos++; // 包含分号，更新命令结束位置
        // 提取可能的注释（// 开头），用于记录命令的 reason
        let comment = '';
        const potentialComment = inputText.substring(endPos).match(/^\s*\/\/(.*)/);
        if (potentialComment) {
            // 提取注释内容并去除首尾空格，更新结束位置
            comment = potentialComment[1].trim();
            endPos += potentialComment[0].length;
        }
        // 提取完整命令字符串，用于返回结果中的 fullMatch 字段，便于追踪原始内容
        const fullMatch = inputText.substring(setStart, endPos);
        // 提取参数字符串，位于开括号和闭括号之间
        const paramsString = inputText.substring(openParen, closeParen);
        // 使用 parseParameters 解析参数，支持嵌套结构（如数组、对象）
        const params = parseParameters(paramsString);
        // 验证命令有效性，根据命令类型检查参数数量，防止无效命令进入结果
        let isValid = false;
        if (commandType === 'set' && params.length >= 2)
            isValid = true; // _.set 至少需要路径和值
        else if (commandType === 'assign' && params.length >= 2)
            isValid = true; // _.assign 支持两种参数格式
        else if (commandType === 'insert' && params.length >= 2)
            isValid = true; // _.insert 支持两种参数格式
        else if (commandType === 'remove' && params.length >= 1)
            isValid = true; // _.remove 至少需要路径
        else if (commandType === 'unset' && params.length >= 1)
            isValid = true; // _.unset 至少需要路径
        else if (commandType === 'delete' && params.length >= 1)
            isValid = true; // _.delete 至少需要路径
        else if (commandType === 'add' && /*params.length === 1 || */ params.length === 2)
            isValid = true; // _.add 需要1个或2个参数
        if (isValid) {
            // 命令有效，添加到结果列表，包含命令类型、完整匹配、参数和注释
            results.push({
                $index: setStart,
                type: commandType,
                full_match: fullMatch,
                args: params,
                reason: comment,
            });
        }
        // 更新搜索索引到命令末尾，继续查找下一个命令
        i = endPos;
    }
    // 返回所有解析出的有效命令
    return _(results)
        .sortBy('$index')
        .map(command => _.omit(command, '$index'))
        .value();
}

function findMatchingCloseParen(str, startPos) {
    let parenCount = 1; // 从1开始，因为已经有一个开括号
    let inQuote = false;
    let quoteChar = '';
    for (let i = startPos; i < str.length; i++) {
        const char = str[i];
        const prevChar = i > 0 ? str[i - 1] : '';
        // 处理引号状态
        // 支持三种引号：双引号、单引号和反引号（模板字符串）
        // 注意：需要检查前一个字符不是反斜杠，以正确处理转义的引号
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
            if (!inQuote) {
                inQuote = true;
                quoteChar = char;
            }
            else if (char === quoteChar) {
                inQuote = false;
            }
        }
        // 只在不在引号内时计算括号
        // 这确保了像 "text with )" 这样的字符串不会影响括号匹配
        if (!inQuote) {
            if (char === '(') {
                parenCount++;
            }
            else if (char === ')') {
                parenCount--;
                if (parenCount === 0) {
                    return i;
                }
            }
        }
    }
    return -1; // 没有找到匹配的闭括号
}

function parseParameters(paramsString) {
    const params = [];
    let currentParam = '';
    let inQuote = false;
    let quoteChar = '';
    let bracketCount = 0;
    let braceCount = 0;
    let parenCount = 0;
    for (let i = 0; i < paramsString.length; i++) {
        const char = paramsString[i];
        // 处理引号（包括反引号）
        if ((char === '"' || char === "'" || char === '`') &&
            (i === 0 || paramsString[i - 1] !== '\\')) {
            if (!inQuote) {
                inQuote = true;
                quoteChar = char;
            }
            else if (char === quoteChar) {
                inQuote = false;
            }
        }
        if (!inQuote) {
            // 处理圆括号 (函数调用、数学运算等)
            if (char === '(')
                parenCount++;
            if (char === ')')
                parenCount--;
            // 处理方括号 (数组)
            if (char === '[')
                bracketCount++;
            if (char === ']')
                bracketCount--;
            // 处理花括号 (对象)
            if (char === '{')
                braceCount++;
            if (char === '}')
                braceCount--;
        }
        // 处理参数分隔符
        // 现在只有当所有括号都匹配闭合时，逗号才被视为分隔符
        if (char === ',' &&
            !inQuote &&
            parenCount === 0 &&
            bracketCount === 0 &&
            braceCount === 0) {
            params.push(currentParam.trim());
            currentParam = '';
            continue;
        }
        currentParam += char;
    }
    // 添加最后一个参数
    if (currentParam.trim()) {
        params.push(currentParam.trim());
    }
    return params;
}

function pathFix(path) {
    if (!path)
        return path;
    // 1. 处理 [] 内的内容，区分数字索引 / 字符串 key
    const fixedBrackets = path.replace(/\[([^\]]*)\]/g, (_match, rawInner) => {
        let inner = rawInner.trim();
        if (!inner) {
            return '[]';
        }
        let wasQuoted = false;
        const first = inner[0];
        const last = inner[inner.length - 1];
        if (inner.length >= 2 && (first === '"' || first === "'") && first === last) {
            wasQuoted = true;
            inner = inner.slice(1, -1);
        }
        const isPureDigits = /^\d+$/.test(inner);
        const hasWhitespace = /\s/.test(inner);
        // 纯数字
        if (isPureDigits) {
            if (!wasQuoted) {
                // 裸数字 → 视为数组索引
                return `[${inner}]`;
            }
            else {
                // 有引号的数字 → 视为字符串 key
                const escaped = inner.replace(/"/g, '\\"');
                return `["${escaped}"]`;
            }
        }
        // 非纯数字 → 字符串 key
        if (hasWhitespace) {
            const escaped = inner.replace(/"/g, '\\"');
            return `["${escaped}"]`;
        }
        else {
            return `[${inner}]`;
        }
    });
    // 2. 处理点分段中被整体引号包裹的字段
    //
    // 规则：
    //   - 无空白 / . / [] → 简单字段，去引号： ["武器栏"] → [武器栏]
    //   - 含空白或特殊字符 → 复杂字段，改写为 bracket：
    //       foo."a b".c    → foo["a b"].c
    //       root.'字段 名'.子 → root["字段 名"].子
    //       foo[喵.呜].c    →  foo["喵.呜"].c
    const fixedDots = fixedBrackets.replace(/(^|\.)(["'])([^"']*)\2(?=\.|\[|$)/g, (_match, prefix, _quote, name) => {
        const hasWhitespace = /\s/.test(name);
        const hasSpecial = /[.[\]]/.test(name);
        if (!hasWhitespace && !hasSpecial) {
            // 简单标识符：保留点
            // 例如 foo."武器栏" → foo.武器栏
            return prefix + name;
        }
        else {
            // 复杂字段：改成 bracket 形式，并去掉多余的点
            const escaped = name.replace(/"/g, '\\"');
            if (prefix === '.') {
                // foo."a b" → foo["a b"]
                return `["${escaped}"]`;
            }
            else {
                // 行首的情况："字段 名".子 → ["字段 名"].子
                return `${prefix}["${escaped}"]`;
            }
        }
    });
    return fixedDots;
}

async function updateVariable(stat_data, path, new_value, reason = '', is_recursive = false) {
    const display_data = stat_data.$internal?.display_data;
    const delta_data = stat_data.$internal?.delta_data;
    if (_.has(stat_data, path)) {
        const currentValue = _.get(stat_data, path);
        if (Array.isArray(currentValue) && currentValue.length === 2) {
            //VWD 处理
            const oldValue = klona(currentValue[0]);
            currentValue[0] = new_value;
            _.set(stat_data, path, currentValue);
            const reason_str = reason ? `(${reason})` : '';
            const display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${trimQuotesAndBackslashes(JSON.stringify(new_value))} ${reason_str}`;
            if (display_data)
                _.set(display_data, path, display_str);
            if (delta_data)
                _.set(delta_data, path, display_str);
            console.info(`Set '${path}' to '${trimQuotesAndBackslashes(JSON.stringify(new_value))}' ${reason_str}`);
            if (is_recursive)
                await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, stat_data, path, oldValue, new_value);
            return true;
        }
        else {
            const oldValue = klona(currentValue);
            _.set(stat_data, path, new_value);
            const reason_str = reason ? `(${reason})` : '';
            const stringNewValue = trimQuotesAndBackslashes(JSON.stringify(new_value));
            const display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${stringNewValue} ${reason_str}`;
            if (display_data)
                _.set(display_data, path, display_str);
            if (delta_data)
                _.set(delta_data, path, display_str);
            console.info(`Set '${path}' to '${stringNewValue}' ${reason_str}`);
            if (is_recursive)
                await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, stat_data, path, oldValue, new_value);
            return true;
        }
    }
    return false;
}

function pathFixPass(_unused_data, commands, _unused_content) {
    for (const command of commands) {
        // JSON Patch 路径已由 jsonPatchPathToCommandPath 按 JSON Pointer 的原始分段编码。
        // 再运行 pathFix 会破坏 bracket path 中作为字面量的点号或方括号。
        if (command.reason === 'json_patch')
            continue;
        command.args[0] = pathFix(trimQuotesAndBackslashes(command.args[0]));
    }
}

function isNullOrWhiteSpace(str) {
    return str == null || str.trim().length === 0;
}

async function updateVariables(current_message_content, variables, errors) {
    // 拷贝一份变量，用于提供给 variable_ended
    const variables_before_update = klona(variables);
    // 深拷贝变量对象，生成状态快照，用于记录显示数据
    const out_status = klona(variables);
    // 初始化增量状态对象，记录变化详情
    const delta_status = { stat_data: {} };
    // 重构新增：统一处理宏替换，确保命令中的宏（如 ${variable}）被替换，提升一致性
    const processed_message_content = substitudeMacros(current_message_content);
    // 使用重构后的 extractCommands 提取所有命令
    const commands = extractCommands(processed_message_content);
    // 触发变量更新开始事件，通知外部系统
    _.set(variables.stat_data, '$internal', {
        display_data: out_status.stat_data,
        delta_data: delta_status.stat_data || {},
    });
    await eventEmit(variable_events.VARIABLE_UPDATE_STARTED, variables);
    let error_info;
    let current_command;
    const outError = function (content) {
        const command = current_command?.full_match ?? tr('runtime.variableUpdate.unknownCommand');
        const title = tr('runtime.variableUpdate.errorTitle', { command });
        console.warn(`${title}\n${content}`);
        errors?.push(`${title}\n${content}`);
        error_info = {
            command,
            content,
        };
    };
    const schema = variables.schema; // 获取 schema，可能为 undefined
    const strict_template = schema?.strictTemplate ?? false;
    const concat_template_array = schema?.concatTemplateArray ?? true;
    const strict_set = schema?.strictSet ?? false;
    //处理别名
    for (const cmd of commands) {
        if (cmd.type === 'remove') {
            cmd.type = 'delete';
        }
        else if (cmd.type === 'assign') {
            cmd.type = 'insert';
        }
        else if (cmd.type === 'unset') {
            cmd.type = 'delete';
        }
    }
    //@ts-expect-error old fn
    await eventEmit(variable_events.COMMAND_PARSED, variables, commands, current_message_content);
    //保证 MVU zod 在所有 COMMAND_PARSED 监听之后
    await eventEmit(variable_events.COMMAND_PARSED + '_for_zod', variables, commands, current_message_content,
    // 只在收集模式传入回调，未传 errors 时让 Zod 保持原有通知行为。
    errors === undefined ? undefined : (error_info) => errors.push(error_info));
    //允许 MVU zod 在处理完所有 COMMAND_PARSED 后清理 commands
    await eventEmit(variable_events.COMMAND_PARSED + '_ended_for_zod', variables, commands, current_message_content);
    pathFixPass(variables, commands, current_message_content);
    for (const command of commands) {
        // 遍历所有命令，逐一处理
        // 修正路径格式，去除首尾引号和反斜杠，确保路径有效
        const path = command.args[0];
        // 生成原因字符串，用于日志和显示
        const reason_str = command.reason ? `(${command.reason})` : '';
        let display_str = ''; // 初始化显示字符串，记录操作详情
        current_command = command;
        switch (command.type // 根据命令类型执行不同操作
        ) {
            case 'set': {
                // _.has 检查，确保路径存在
                if (path !== '' && !_.has(variables.stat_data, path)) {
                    outError(tr('runtime.variableUpdate.setPathMissing', { path, reason: reason_str }));
                    continue;
                }
                // 获取路径上的旧值，可能为 undefined（路径不存在）
                let oldValue = path === '' ? klona(variables.stat_data) : _.get(variables.stat_data, path);
                // 支持两种格式：_.set(path, newValue) 或 _.set(path, oldValue, newValue)
                //   解析新值，支持字符串、数字、布尔值、JSON 对象等
                let newValue = parseCommandValue(command.args.at(-1));
                // 在写入前，将 Date 对象序列化为 ISO 字符串
                if (newValue instanceof Date) {
                    newValue = newValue.toISOString();
                }
                let isPathVWD = false;
                if (!strict_set &&
                    Array.isArray(oldValue) &&
                    oldValue.length === 2 &&
                    typeof oldValue[1] === 'string' &&
                    !Array.isArray(oldValue[0])) {
                    // 处理 ValueWithDescription<T> 类型，更新数组第一个元素
                    // 仅当旧值为数字且新值不为 null 时，才强制转换为数字
                    // 这允许将数字字段设置为 null (例如角色死亡后好感度变为 null)
                    const oldValueCopy = klona(oldValue[0]);
                    oldValue[0] =
                        typeof oldValue[0] === 'number' && newValue !== null
                            ? Number(newValue)
                            : newValue;
                    oldValue = oldValueCopy;
                    isPathVWD = true;
                }
                else if (typeof oldValue === 'number' &&
                    newValue !== null &&
                    typeof newValue === 'string') {
                    _.set(variables.stat_data, path, Number(newValue));
                }
                else if (path) {
                    _.set(variables.stat_data, path, newValue);
                }
                else {
                    variables.stat_data = newValue;
                }
                // 获取最终设置的新值，用于日志和事件
                let finalNewValue = path === '' ? variables.stat_data : _.get(variables.stat_data, path);
                assertVWD(isPathVWD, finalNewValue);
                if (isPathVWD) {
                    finalNewValue = finalNewValue[0];
                }
                // 检查是否为 ValueWithDescription 类型，以优化显示
                const isStrict = !strict_set;
                if (isStrict &&
                    isValueWithDescriptionStatData(oldValue) &&
                    Array.isArray(finalNewValue)) {
                    // 如果是 ValueWithDescription，只显示值的变化
                    display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue[0]))}->${trimQuotesAndBackslashes(JSON.stringify(finalNewValue[0]))} ${reason_str}`;
                }
                else {
                    // 否则，按常规显示
                    display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${trimQuotesAndBackslashes(JSON.stringify(finalNewValue))} ${reason_str}`;
                }
                // 记录操作日志，便于调试
                console.info(`Set '${path}' to '${JSON.stringify(finalNewValue)}' ${reason_str}`);
                // 触发单变量更新事件，通知外部系统
                await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, oldValue, finalNewValue);
                break;
            }
            case 'insert':
            case 'assign': {
                // 检查目标路径是否指向一个集合（数组或对象）
                // 如果路径已存在且其值为原始类型（字符串、数字等），则跳过此命令，以防止结构污染
                const targetPath = path;
                // 统一获取目标值和目标Schema，优雅地处理根路径
                const existingValue = targetPath === ''
                    ? variables.stat_data
                    : _.get(variables.stat_data, targetPath);
                const targetSchema = getSchemaForPath(schema, targetPath);
                // 验证1：目标是否为原始类型？如果是，则无法插入。
                if (existingValue !== null &&
                    !Array.isArray(existingValue) &&
                    !_.isObject(existingValue)) {
                    outError(tr('runtime.variableUpdate.assignPrimitive', {
                        path: targetPath,
                        type: typeof existingValue,
                        reason: reason_str,
                    }));
                    continue;
                }
                // 验证2：Schema 规则
                if (targetSchema) {
                    if (targetSchema.type === 'object' && targetSchema.extensible === false) {
                        if (command.args.length === 2) {
                            // 合并
                            outError(tr('runtime.variableUpdate.mergeNonExtensibleObject', {
                                path: targetPath,
                                reason: reason_str,
                            }));
                            continue;
                        }
                        if (command.args.length >= 3) {
                            // 插入键
                            const newKey = String(parseCommandValue(command.args[1]));
                            if (!_.has(targetSchema.properties, newKey)) {
                                outError(tr('runtime.variableUpdate.assignUnknownKey', {
                                    key: newKey,
                                    path: targetPath,
                                    reason: reason_str,
                                }));
                                continue;
                            }
                        }
                    }
                    else if (targetSchema.type === 'array' &&
                        (targetSchema.extensible === false || targetSchema.extensible === undefined)) {
                        outError(tr('runtime.variableUpdate.assignNonExtensibleArray', {
                            path: targetPath,
                            reason: reason_str,
                        }));
                        continue;
                    }
                }
                else if (
                // 增加 targetPath !== '' 条件，防止对根路径进行父路径检查
                targetPath !== '' &&
                    !_.get(variables.stat_data, pathSegmentsToLodashPath(_.toPath(targetPath).slice(0, -1)))) {
                    // 验证3：如果要插入到新路径，确保其父路径存在且可扩展
                    outError(tr('runtime.variableUpdate.assignMissingParent', {
                        path: targetPath,
                        reason: reason_str,
                    }));
                    continue;
                }
                // --- 所有验证通过，现在可以安全执行 ---
                // 深拷贝旧值，防止直接修改影响后续比较
                const oldValue = klona(existingValue);
                let successful = false; // 标记插入是否成功
                if (command.args.length === 2) {
                    // _.assign('path.to.array', value)
                    // 解析插入值，支持复杂类型
                    let valueToAssign = parseCommandValue(command.args[1]);
                    // 在写入前，将 Date 对象（或数组中的Date）序列化
                    if (valueToAssign instanceof Date) {
                        valueToAssign = valueToAssign.toISOString();
                    }
                    else if (Array.isArray(valueToAssign)) {
                        valueToAssign = valueToAssign.map(item => item instanceof Date ? item.toISOString() : item);
                    }
                    // 获取目标集合，可能为数组或对象
                    let collection = targetPath === '' ? variables.stat_data : _.get(variables.stat_data, path);
                    // 如果目标不存在，初始化为空数组或对象
                    if (!Array.isArray(collection) && !_.isObject(collection)) {
                        collection = Array.isArray(valueToAssign) ? [] : {};
                        _.set(variables.stat_data, path, collection);
                    }
                    if (Array.isArray(collection)) {
                        // 目标是数组，追加元素
                        // 检查是否有模板并应用
                        const template = targetSchema && isArraySchema(targetSchema)
                            ? targetSchema.template
                            : undefined;
                        valueToAssign = applyTemplate(valueToAssign, template, strict_template, concat_template_array);
                        collection.push(valueToAssign);
                        display_str = `ASSIGNED ${JSON.stringify(valueToAssign)} into array '${path}' ${reason_str}`;
                        successful = true;
                    }
                    else if (_.isObject(collection)) {
                        // 目标是对象，合并属性
                        // 注意：对象合并时不应用模板，因为无法明确确定增加的元素
                        // 模板只在明确添加单个新属性时应用（如使用三参数的 assign）
                        if (_.isObject(valueToAssign) && !Array.isArray(valueToAssign)) {
                            _.merge(collection, valueToAssign);
                            display_str = `MERGED object ${JSON.stringify(valueToAssign)} into object '${path}' ${reason_str}`;
                            successful = true;
                        }
                        else {
                            // 不支持将数组或非对象合并到对象，记录错误
                            outError(tr(Array.isArray(valueToAssign)
                                ? 'runtime.variableUpdate.mergeArrayIntoObject'
                                : 'runtime.variableUpdate.mergeNonObjectIntoObject', { path }));
                            continue;
                        }
                    }
                }
                else if (command.args.length >= 3) {
                    // _.assign('path', key/index, value)
                    // 解析插入值和键/索引
                    let valueToAssign = parseCommandValue(command.args[2]);
                    const keyOrIndex = parseCommandValue(command.args[1]);
                    // 在写入前，将 Date 对象（或数组中的Date）序列化
                    if (valueToAssign instanceof Date) {
                        valueToAssign = valueToAssign.toISOString();
                    }
                    else if (Array.isArray(valueToAssign)) {
                        valueToAssign = valueToAssign.map(item => item instanceof Date ? item.toISOString() : item);
                    }
                    let collection = targetPath === '' ? variables.stat_data : _.get(variables.stat_data, path);
                    // 获取模板
                    const template = targetSchema &&
                        (isArraySchema(targetSchema) || isObjectSchema(targetSchema))
                        ? targetSchema.template
                        : undefined;
                    if (Array.isArray(collection) &&
                        (typeof keyOrIndex === 'number' || keyOrIndex === '-')) {
                        // 目标是数组且索引是数字，插入到指定位置
                        // JSON Patch 中的 "-" 表示追加到数组末尾，而不是字面量键名。
                        const insertIndex = keyOrIndex === '-' ? collection.length : keyOrIndex;
                        const positionLabel = keyOrIndex === '-' || keyOrIndex === -1 ? 'tail' : keyOrIndex;
                        valueToAssign = applyTemplate(valueToAssign, template, strict_template, concat_template_array);
                        collection.splice(insertIndex, 0, valueToAssign);
                        display_str = `ASSIGNED ${JSON.stringify(valueToAssign)} into '${path}' at index ${positionLabel} ${reason_str}`;
                        successful = true;
                    }
                    else if (_.isObject(collection)) {
                        // 目标是对象，设置指定键
                        // _.set(collection, String(keyOrIndex), valueToAssign);
                        // 对单个属性值应用模板
                        valueToAssign = applyTemplate(valueToAssign, template, strict_template, concat_template_array);
                        collection[String(keyOrIndex)] = valueToAssign;
                        display_str = `ASSIGNED key '${keyOrIndex}' with value ${JSON.stringify(valueToAssign)} into object '${path}' ${reason_str}`;
                        successful = true;
                    }
                    else {
                        // 目标不存在，创建新对象并插入
                        collection = {};
                        _.set(variables.stat_data, path, collection);
                        /*
                        _.set(
                            collection as Record<string, unknown>,
                            String(keyOrIndex),
                            valueToAssign
                        );
                        */
                        // 对新属性值应用模板
                        valueToAssign = applyTemplate(valueToAssign, template, strict_template, concat_template_array);
                        collection[String(keyOrIndex)] = valueToAssign;
                        display_str = `CREATED object at '${path}' and ASSIGNED key '${keyOrIndex}' ${reason_str}`;
                        successful = true;
                    }
                }
                if (successful) {
                    // 插入成功，获取新值并触发事件
                    const newValue = isNullOrWhiteSpace(path)
                        ? variables.stat_data
                        : _.get(variables.stat_data, path);
                    console.info(display_str);
                    await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, oldValue, newValue);
                    try {
                        //对新应用的 template 立刻处理模板。
                        const currentDataClone = klona(newValue);
                        const newSchema = generateSchema(currentDataClone, targetSchema);
                        _.merge(targetSchema, newSchema);
                        cleanUpMetadata(newValue);
                    }
                    catch (error) {
                        // 应用失败，记录错误并继续处理下一命令
                        outError(tr('runtime.variableUpdate.templateResolutionFailed', {
                            path,
                            cause: error instanceof Error ? error.message : String(error),
                        }));
                    }
                }
                else {
                    // 插入失败，记录错误并继续处理下一命令
                    outError(tr('runtime.variableUpdate.assignInvalidArguments', { path }));
                    continue;
                }
                break;
            }
            case 'unset':
            case 'delete':
            case 'remove': {
                // --- handle array element removal correctly ---
                const pathParts = _.toPath(path);
                const lastPart = pathParts[pathParts.length - 1];
                const isArrayElementPath = /^\d+$/.test(lastPart);
                if (command.args.length === 1 && isArrayElementPath) {
                    const containerPath = pathSegmentsToLodashPath(pathParts.slice(0, -1));
                    //根对象必不是一个数组，在下面 isArray 部分会失败
                    const container = _.get(variables.stat_data, containerPath);
                    const indexToRemove = parseInt(lastPart, 10);
                    if (Array.isArray(container) && indexToRemove < container.length) {
                        const originalArray = klona(container);
                        container.splice(indexToRemove, 1);
                        display_str = `REMOVED item from '${containerPath}' at index ${indexToRemove} ${reason_str}`;
                        console.info(display_str);
                        await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, containerPath, originalArray, container);
                        continue; // Skip to next command
                    }
                }
                // 验证路径存在，防止无效删除
                // 不允许 _.remove('', 'val');
                if (!_.has(variables.stat_data, path)) {
                    outError(tr('runtime.variableUpdate.removePathUndefined', { path }));
                    continue;
                }
                // --- 模式校验开始 ---
                let containerPath = path;
                let keyOrIndexToRemove;
                if (command.args.length > 1) {
                    // _.remove('path', key_or_index)
                    keyOrIndexToRemove = parseCommandValue(command.args[1]);
                    // 如果 key 是字符串，需要去除可能存在的引号
                    if (typeof keyOrIndexToRemove === 'string') {
                        keyOrIndexToRemove = trimQuotesAndBackslashes(keyOrIndexToRemove);
                    }
                }
                else {
                    // _.remove('path.to.key[index]')
                    const pathParts = _.toPath(path);
                    const lastPart = pathParts.pop();
                    if (lastPart) {
                        keyOrIndexToRemove = /^\d+$/.test(lastPart) ? Number(lastPart) : lastPart;
                        containerPath = pathSegmentsToLodashPath(pathParts);
                    }
                }
                if (keyOrIndexToRemove === undefined) {
                    outError(tr('runtime.variableUpdate.deleteTargetUndetermined', {
                        path,
                        reason: reason_str,
                    }));
                    continue;
                }
                // 只有当容器路径不是根路径（即不为空）时，才检查其是否存在
                if (containerPath !== '' && !_.has(variables.stat_data, containerPath)) {
                    outError(tr('runtime.variableUpdate.removePathMissing', {
                        path: containerPath,
                        reason: reason_str,
                    }));
                    continue;
                }
                const containerSchema = getSchemaForPath(schema, containerPath);
                if (containerSchema) {
                    if (containerSchema.type === 'array') {
                        if (containerSchema.extensible !== true) {
                            outError(tr('runtime.variableUpdate.removeNonExtensibleArray', {
                                path: containerPath,
                                reason: reason_str,
                            }));
                            continue;
                        }
                    }
                    else if (containerSchema.type === 'object') {
                        const keyString = String(keyOrIndexToRemove);
                        if (_.has(containerSchema.properties, keyString) &&
                            containerSchema.properties[keyString].required === true) {
                            outError(tr('runtime.variableUpdate.removeRequiredKey', {
                                key: keyString,
                                path: containerPath,
                                reason: reason_str,
                            }));
                            continue;
                        }
                    }
                }
                // --- 所有验证通过，现在可以安全执行 ---
                // 解析删除目标，可能是值或索引
                const targetToRemove = command.args.length > 1 ? parseCommandValue(command.args[1]) : undefined;
                let itemRemoved = false; // 标记是否删除成功
                if (targetToRemove === undefined) {
                    // _.remove('path.to.key')
                    // 删除整个路径
                    const oldValue = _.get(variables.stat_data, path);
                    _.unset(variables.stat_data, path);
                    display_str = `REMOVED path '${path}' ${reason_str}`;
                    itemRemoved = true;
                    await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, oldValue, undefined);
                }
                else {
                    // _.remove('path.to.array', value_or_index)
                    const collection = _.get(variables.stat_data, path);
                    // 当从一个集合中删除元素时，必须确保目标路径确实是一个集合
                    // 如果目标是原始值（例如字符串），则无法执行删除操作
                    if (!Array.isArray(collection) && !_.isObject(collection)) {
                        outError(tr('runtime.variableUpdate.removeNonCollection', {
                            path,
                            reason: reason_str,
                        }));
                        continue;
                    }
                    if (Array.isArray(collection)) {
                        // 目标是数组，删除指定元素
                        const originalArray = klona(collection);
                        let indexToRemove = -1;
                        if (typeof targetToRemove === 'number') {
                            indexToRemove = targetToRemove;
                        }
                        else {
                            indexToRemove = collection.findIndex(item => _.isEqual(item, targetToRemove));
                        }
                        if (indexToRemove >= 0 && indexToRemove < collection.length) {
                            collection.splice(indexToRemove, 1);
                            itemRemoved = true;
                            display_str = `REMOVED item from '${path}' ${reason_str}`;
                            await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, originalArray, collection);
                        }
                    }
                    else if (_.isObject(collection)) {
                        if (typeof targetToRemove === 'number') {
                            // 目标是对象，按索引删除键
                            const keys = Object.keys(collection);
                            const index = targetToRemove;
                            if (index >= 0 && index < keys.length) {
                                const keyToRemove = keys[index];
                                _.unset(collection, keyToRemove);
                                itemRemoved = true;
                                display_str = `REMOVED ${index + 1}th entry ('${keyToRemove}') from object '${path}' ${reason_str}`;
                            }
                        }
                        else {
                            // 目标是对象，按键名删除
                            const keyToRemove = String(targetToRemove);
                            if (_.has(collection, keyToRemove)) {
                                // _.unset(collection, keyToRemove);
                                delete collection[keyToRemove];
                                itemRemoved = true;
                                display_str = `REMOVED key '${keyToRemove}' from object '${path}' ${reason_str}`;
                            }
                        }
                    }
                }
                if (itemRemoved) {
                    // 删除成功，更新状态并记录日志
                    console.info(display_str);
                }
                else {
                    // 删除失败，记录警告并继续
                    outError(tr('runtime.variableUpdate.removeExecutionFailed', { path }));
                    continue;
                }
                break;
            }
            case 'add': {
                // 验证路径存在
                if (!_.has(variables.stat_data, path)) {
                    outError(tr('runtime.variableUpdate.addPathMissing', {
                        path,
                        reason: reason_str,
                    }));
                    continue;
                }
                // 获取当前值
                const initialValue = klona(_.get(variables.stat_data, path));
                const oldValue = _.get(variables.stat_data, path);
                let valueToAdd = oldValue;
                const isVWD = isValueWithDescriptionStatData(oldValue) && typeof oldValue[0] !== 'object';
                if (isVWD) {
                    assertVWD(isVWD, oldValue);
                    valueToAdd = oldValue[0]; // 对 ValueWithDescription 类型，操作其第一个元素
                }
                // console.warn(valueToAdd);
                // 尝试将当前值解析为 Date 对象，无论其原始类型是 Date 还是字符串
                let potentialDate = null;
                if (valueToAdd instanceof Date) {
                    potentialDate = valueToAdd;
                }
                else if (typeof valueToAdd === 'string') {
                    const parsedDate = new Date(valueToAdd);
                    // 确保它是一个有效的日期，并且不是一个可以被 `new Date` 解析的纯数字字符串
                    if (!isNaN(parsedDate.getTime()) && isNaN(Number(valueToAdd))) {
                        potentialDate = parsedDate;
                    }
                }
                if (command.args.length === 2) {
                    // 双参数：调整数值或日期
                    const delta = parseCommandValue(command.args[1]);
                    // 处理 Date 类型
                    if (potentialDate) {
                        if (typeof delta !== 'number') {
                            outError(tr('runtime.variableUpdate.dateDeltaNotNumber', {
                                delta: command.args[1],
                                reason: reason_str,
                            }));
                            continue;
                        }
                        // delta 是毫秒数，更新时间
                        const newDate = new Date(potentialDate.getTime() + delta);
                        // 总是将更新后的 Date 对象转换为 ISO 字符串再存回去
                        const finalValueToSet = newDate.toISOString();
                        if (isVWD) {
                            assertVWD(isVWD, oldValue);
                            oldValue[0] = finalValueToSet;
                            _.set(variables.stat_data, path, oldValue);
                        }
                        else {
                            _.set(variables.stat_data, path, finalValueToSet);
                        }
                        const finalNewValue = _.get(variables.stat_data, path);
                        if (isVWD) {
                            display_str = `${JSON.stringify(initialValue[0])}->${JSON.stringify(finalNewValue[0])} ${reason_str}`;
                        }
                        else {
                            display_str = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
                        }
                        console.info(`ADDED date '${path}' from '${potentialDate.toISOString()}' to '${newDate.toISOString()}' by delta '${delta}'ms ${reason_str}`);
                        await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, initialValue, finalNewValue);
                    }
                    else if (typeof valueToAdd === 'number') {
                        // 原有的处理 number 类型的逻辑
                        if (typeof delta !== 'number') {
                            outError(tr('runtime.variableUpdate.deltaNotNumber', {
                                delta: command.args[1],
                                reason: reason_str,
                            }));
                            continue;
                        }
                        let newValue = valueToAdd + delta;
                        newValue = parseFloat(newValue.toPrecision(12)); // 避免浮点数精度误差
                        if (isVWD) {
                            oldValue[0] = newValue; // Update the first element
                            _.set(variables.stat_data, path, oldValue);
                        }
                        else {
                            _.set(variables.stat_data, path, newValue);
                        }
                        const finalNewValue = _.get(variables.stat_data, path);
                        if (isVWD) {
                            display_str = `${JSON.stringify(initialValue[0])}->${JSON.stringify(finalNewValue[0])} ${reason_str}`;
                        }
                        else {
                            display_str = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
                        }
                        console.info(`ADDED number '${path}' from '${valueToAdd}' to '${newValue}' by delta '${delta}' ${reason_str}`);
                        await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, initialValue, finalNewValue);
                    }
                    else {
                        // 如果值不是可识别的类型（日期、数字），则跳过
                        outError(tr('runtime.variableUpdate.addUnsupportedValue', {
                            path,
                            reason: reason_str,
                        }));
                        continue;
                    }
                }
                else {
                    outError(tr('runtime.variableUpdate.addInvalidArguments', {
                        path,
                        reason: reason_str,
                    }));
                    continue;
                }
                break;
            }
        }
        if (display_str) {
            // 更新状态和增量数据，记录操作详情
            _.set(out_status.stat_data, path, display_str);
            _.set(delta_status.stat_data, path, display_str);
        }
    }
    // 更新变量的显示和增量数据
    variables.display_data = out_status.stat_data;
    variables.delta_data = delta_status.stat_data;
    // 触发变量更新结束事件
    await eventEmit(variable_events.VARIABLE_UPDATE_ENDED, variables, variables_before_update);
    //在结束事件中也可能设置变量
    _.unset(variables.stat_data, '$internal');
    // 在所有命令执行完毕后，如果数据有任何变动，则执行一次 Schema 调和
    const is_modified = !_.isEqual(variables.stat_data, variables_before_update.stat_data);
    if (is_modified) {
        reconcileAndApplySchema(variables);
    }
    await eventEmit(variable_events.VARIABLE_UPDATE_ENDED + '_for_zod', variables, variables_before_update);
    if (errors === undefined && error_info && useDataStore().settings.通知.变量更新出错) {
        toastr.warning(tr('runtime.variableUpdate.errorDetail', {
            detail: _.escape(error_info.content),
        }), tr('runtime.variableUpdate.errorTitle', {
            command: _.escape(error_info.command),
        }), { timeOut: 6000 });
    }
    return is_modified;
}

async function loadInitVarData(mvu_data, lorebook_list) {
    const enabled_lorebook_list = lorebook_list || (await getEnabledLorebookList());
    let is_updated = false;
    // 确保 initialized_lorebooks 是对象格式
    if (!mvu_data.initialized_lorebooks || Array.isArray(mvu_data.initialized_lorebooks)) {
        mvu_data.initialized_lorebooks = {};
    }
    for (const current_lorebook of enabled_lorebook_list) {
        // 适配 beta 分支的对象结构
        if (_.has(mvu_data.initialized_lorebooks, current_lorebook))
            continue;
        mvu_data.initialized_lorebooks[current_lorebook] = [];
        try {
            const init_entries = (await getLorebookEntries(current_lorebook));
            const merged_data = {};
            for (const entry of init_entries) {
                if (entry.comment?.toLowerCase().includes('[initvar]')) {
                    const xml_match = entry.content
                        .trim()
                        .match(/.*<initvar>.*\n([\s\S]*)\n.*<\/initvar>.*/m);
                    if (xml_match) {
                        entry.content = xml_match[1];
                    }
                    const codeblock_match = entry.content.trim().match(/```.*\n([\s\S]*)\n```/m);
                    if (codeblock_match) {
                        entry.content = codeblock_match[1];
                    }
                    const content = substitudeMacros(entry.content);
                    let parsedData = null;
                    let parseError = null;
                    // Try YAML first (which also handles JSON)
                    try {
                        parsedData = parseString(content);
                    }
                    catch (e) {
                        parseError = e;
                    }
                    if (parseError) {
                        console.error(tr('runtime.initvar.entryParseFailedLog', {
                            comment: entry.comment ?? '',
                            cause: String(parseError),
                        }));
                        toastr.error(tr('runtime.common.errorCause', {
                            cause: _.escape(parseError.message),
                        }), tr('runtime.initvar.entryParseFailedTitle', {
                            comment: _.escape(entry.comment ?? ''),
                        }), {
                            timeOut: 5000,
                        });
                        throw parseError;
                    }
                    if (parsedData) {
                        correctlyMerge(merged_data, parsedData);
                    }
                }
            }
            mvu_data.stat_data = { ...merged_data, ...mvu_data.stat_data };
            is_updated = true;
        }
        catch (e) {
            console.error(e);
        }
    }
    return is_updated;
}

function createEmptyGameData() {
    return {
        display_data: {},
        initialized_lorebooks: {}, // 适配 beta 分支的对象结构
        stat_data: {},
        delta_data: {},
        schema: {
            type: 'object',
            properties: {},
        }, // beta 分支新增的 schema 字段
    };
}
return { updateVariables, updateVariable, loadInitVarData, createEmptyGameData, variable_events, parseString };
}
