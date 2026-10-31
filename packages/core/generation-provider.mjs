const textOf = content => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(part => part.type === 'text').map(part => part.text ?? '').join('') : '';
const argumentsOf = value => typeof value === 'string' ? value : JSON.stringify(value ?? {});
const parsedArguments = value => typeof value === 'string' ? JSON.parse(value || '{}') : value ?? {};
const familyOf = source => {
  if (['openai', 'custom', 'openrouter', 'deepseek', 'xai'].includes(source)) return 'openai';
  if (['claude', 'anthropic'].includes(source)) return 'claude';
  if (['makersuite', 'google', 'gemini'].includes(source)) return 'google';
  throw new Error(`尚未接入自定义 API 源：${source}`);
};

function endpoint(api, family, streaming) {
  if (!api.apiurl) throw new Error('自定义 API 需要 apiurl');
  let url;
  try { url = new URL(api.apiurl); } catch { throw new Error('自定义 API 地址格式无效'); }
  let pathname = url.pathname.replace(/\/+$/, '');
  if (family === 'google') {
    const method = streaming ? 'streamGenerateContent' : 'generateContent';
    if (/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/.test(pathname)) {
      pathname = pathname.replace(/:(?:streamGenerateContent|generateContent)$/, ':' + method);
      if (api.model) pathname = pathname.replace(/\/models\/[^/]+:/, `/models/${encodeURIComponent(api.model.replace(/^models\//, ''))}:`);
    } else {
      if (!api.model) throw new Error('Gemini 请求需要模型名称');
      if (!pathname) pathname = '/v1beta';
      pathname += `/models/${encodeURIComponent(api.model.replace(/^models\//, ''))}:${method}`;
    }
    if (streaming) url.searchParams.set('alt', 'sse');
    else if (url.searchParams.get('alt') === 'sse') url.searchParams.delete('alt');
  } else {
    const suffix = family === 'claude' ? '/messages' : '/chat/completions';
    if (!pathname.endsWith(suffix)) pathname = (pathname || '/v1') + suffix;
  }
  url.pathname = pathname;
  return url;
}

function imagePart(part, family) {
  const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
  if (!url) throw new Error('图片消息缺少 image_url');
  const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
  if (family === 'claude') return { type: 'image', source: data
    ? { type: 'base64', media_type: data[1], data: data[2] } : { type: 'url', url } };
  return data ? { inlineData: { mimeType: data[1], data: data[2] } }
    : { fileData: { mimeType: part.mime_type ?? 'image/jpeg', fileUri: url } };
}

function nativeMessages(messages, family) {
  const system = messages.filter(message => ['system', 'developer'].includes(message.role)).map(message => textOf(message.content)).join('\n\n');
  const toolNames = new Map(messages.flatMap(message => (message.tool_calls ?? []).map(call => [call.id, call.function?.name])));
  const result = messages.filter(message => !['system', 'developer'].includes(message.role)).map(message => {
    if (message.role === 'tool') {
      if (family === 'claude') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: textOf(message.content) }] };
      let response;
      try { response = parsedArguments(textOf(message.content)); } catch { response = { result: textOf(message.content) }; }
      if (response === null || typeof response !== 'object' || Array.isArray(response)) response = { result: response };
      return { role: 'user', parts: [{ functionResponse: { name: message.name ?? toolNames.get(message.tool_call_id) ?? message.tool_call_id, response } }] };
    }
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }]
      : Array.isArray(message.content) ? message.content : [];
    const parts = blocks.filter(part => part.type !== 'text' || part.text?.length).map(part => part.type === 'image_url' ? imagePart(part, family)
      : family === 'google' && part.type === 'text' ? { text: part.text ?? '' } : { ...part });
    if (message.role === 'assistant' && message.reasoning && message.reasoning_signature) {
      parts.unshift(family === 'claude'
        ? { type: 'thinking', thinking: message.reasoning, signature: message.reasoning_signature }
        : { text: message.reasoning, thought: true, thoughtSignature: message.reasoning_signature });
    }
    for (const call of message.tool_calls ?? []) {
      const input = parsedArguments(call.function?.arguments);
      parts.push(family === 'claude' ? { type: 'tool_use', id: call.id, name: call.function.name, input }
        : { functionCall: { name: call.function.name, args: input }, ...(call.thought_signature ? { thoughtSignature: call.thought_signature } : {}) });
    }
    return family === 'claude' ? { role: message.role, content: parts }
      : { role: message.role === 'assistant' ? 'model' : message.role, parts };
  });
  return { system, messages: result };
}

function requestBody(messages, config, settings, api, family) {
  const sampling = {};
  for (const [name, defaultValue] of Object.entries({ max_tokens: null, temperature: 1, frequency_penalty: 0, presence_penalty: 0, top_p: 1, top_k: 0 })) {
    const value = api[name] ?? 'same_as_preset';
    if (value === 'unset' || value === defaultValue) continue;
    const preset = settings[name] ?? (name === 'max_tokens' ? settings.max_completion_tokens ?? settings.openai_max_tokens : undefined);
    const effective = value === 'same_as_preset' ? preset : value;
    if (effective !== undefined) {
      if (typeof effective !== 'number' || !Number.isFinite(effective)) throw new TypeError(`生成参数 ${name} 必须是有限数字`);
      sampling[name] = effective;
    }
  }
  const tools = config.tools ?? [];
  if (!Array.isArray(tools)) throw new TypeError('tools 必须是数组');
  if (tools.length && config.json_schema) throw new Error('tools 与 json_schema 不能同时设置');
  const schema = config.json_schema;
  if (schema && (!schema.value || typeof schema.value !== 'object')) throw new TypeError('json_schema 需要 value 对象');
  const forced = typeof config.tool_choice === 'object' ? config.tool_choice.function?.name : undefined;
  let body;
  if (family === 'openai') {
    if (!['custom', 'openrouter'].includes(api.source)) delete sampling.top_k;
    body = { model: api.model, messages, ...sampling, stream: !!config.should_stream };
    if (tools.length) { body.tools = tools; body.tool_choice = config.tool_choice === 'any' ? 'required' : config.tool_choice ?? 'auto'; }
    if (schema) body.response_format = { type: 'json_schema', json_schema: { name: schema.name, description: schema.description, schema: schema.value, strict: schema.strict ?? true } };
    if (api.source === 'custom') {
      Object.assign(body, api.custom_include_body);
      for (const name of api.custom_exclude_body ?? []) delete body[name];
    }
  } else {
    const converted = nativeMessages(messages, family);
    if (family === 'claude') {
      body = { model: api.model, messages: converted.messages, stream: !!config.should_stream };
      if (converted.system) body.system = converted.system;
      for (const name of ['max_tokens', 'temperature', 'top_p', 'top_k']) if (sampling[name] !== undefined) body[name] = sampling[name];
      if (body.max_tokens === undefined && api.max_tokens !== 'unset') body.max_tokens = 1024;
      if (tools.length) {
        body.tools = tools.map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters ?? { type: 'object', properties: {} } }));
        body.tool_choice = forced ? { type: 'tool', name: forced } : { type: ['any', 'required'].includes(config.tool_choice) ? 'any' : config.tool_choice ?? 'auto' };
      }
      if (schema) {
        body.tools = [{ name: schema.name ?? 'structured_output', description: schema.description, input_schema: schema.value }];
        body.tool_choice = { type: 'tool', name: body.tools[0].name };
      }
    } else {
      body = { contents: converted.messages, generationConfig: {} };
      if (converted.system) body.systemInstruction = { parts: [{ text: converted.system }] };
      for (const [from, to] of Object.entries({ max_tokens: 'maxOutputTokens', temperature: 'temperature', top_p: 'topP', top_k: 'topK', frequency_penalty: 'frequencyPenalty', presence_penalty: 'presencePenalty' })) {
        if (sampling[from] !== undefined) body.generationConfig[to] = sampling[from];
      }
      if (tools.length) {
        body.tools = [{ functionDeclarations: tools.map(tool => ({ ...tool.function })) }];
        body.toolConfig = { functionCallingConfig: { mode: forced || ['any', 'required'].includes(config.tool_choice) ? 'ANY' : config.tool_choice === 'none' ? 'NONE' : 'AUTO', ...(forced ? { allowedFunctionNames: [forced] } : {}) } };
      }
      if (schema) Object.assign(body.generationConfig, { responseMimeType: 'application/json', responseJsonSchema: schema.value });
    }
  }
  return body;
}

function responseAccumulator(family, schema) {
  const state = { content: '', reasoning: '', reasoning_signature: '' }, calls = new Map(), toolSignatures = new Map();
  const callAt = index => {
    if (!calls.has(index)) calls.set(index, { id: '', type: 'function', function: { name: '', arguments: '' } });
    return calls.get(index);
  };
  const accept = (data, event) => {
    if (!data || typeof data !== 'object') throw new Error('模型响应格式无效');
    if (data.error || event === 'error') throw new Error(`模型返回错误：${data.error?.message ?? data.error?.type ?? data.message ?? JSON.stringify(data.error ?? data)}`);
    if (family === 'openai') {
      const message = data.choices?.[0]?.delta ?? data.choices?.[0]?.message;
      if (!message) return false;
      state.content += textOf(message.content) || message.refusal || '';
      state.reasoning += message.reasoning_content ?? message.reasoning ?? '';
      for (const detail of message.reasoning_details ?? []) {
        if (detail.type === 'reasoning.text') state.reasoning += detail.text ?? '';
        if (detail.type === 'reasoning.encrypted' && detail.data) {
          if (/^(tool_|call_)/.test(detail.id ?? '')) toolSignatures.set(detail.id, detail.data);
          else state.reasoning_signature += detail.data;
        }
      }
      for (const [index, delta] of (message.tool_calls ?? []).entries()) {
        const call = callAt(delta.index ?? index);
        call.id += delta.id ?? ''; call.function.name += delta.function?.name ?? '';
        call.function.arguments += delta.function?.arguments ?? '';
        if (delta.thought_signature ?? delta.thoughtSignature) call.thought_signature = delta.thought_signature ?? delta.thoughtSignature;
      }
      for (const call of calls.values()) if (toolSignatures.has(call.id)) call.thought_signature = toolSignatures.get(call.id);
    } else if (family === 'claude') {
      const blocks = data.content ?? data.message?.content ?? (data.content_block ? [data.content_block] : []);
      for (const [index, block] of blocks.entries()) {
        if (block.type === 'text') state.content += block.text ?? '';
        if (block.type === 'thinking') { state.reasoning += block.thinking ?? ''; state.reasoning_signature += block.signature ?? ''; }
        if (block.type === 'tool_use') {
          const call = callAt(data.index ?? index);
          call.id = block.id; call.function.name = block.name; call.function.arguments = argumentsOf(block.input);
        }
      }
      const delta = data.delta;
      if (delta?.type === 'text_delta') state.content += delta.text ?? '';
      if (delta?.type === 'thinking_delta') state.reasoning += delta.thinking ?? '';
      if (delta?.type === 'signature_delta') state.reasoning_signature += delta.signature ?? '';
      if (delta?.type === 'input_json_delta') {
        const call = callAt(data.index ?? 0);
        call.partial = (call.partial ?? '') + (delta.partial_json ?? '');
        call.function.arguments = call.partial;
      }
    } else {
      for (const part of data.candidates?.[0]?.content?.parts ?? []) {
        if (part.thought) state.reasoning += part.text ?? '';
        else state.content += part.text ?? '';
        if (part.thoughtSignature && Object.hasOwn(part, 'text')) state.reasoning_signature = part.thoughtSignature;
        if (part.functionCall) {
          const call = callAt(calls.size);
          call.id = part.functionCall.id ?? ''; call.function.name = part.functionCall.name;
          call.function.arguments = argumentsOf(part.functionCall.args);
          if (part.thoughtSignature) call.thought_signature = part.thoughtSignature;
        }
      }
      if (data.promptFeedback?.blockReason) throw new Error(`模型未生成回复：${data.promptFeedback.blockReason}`);
    }
    return data.type === 'message_stop';
  };
  const result = reasoning => {
    const toolCalls = [...calls.values()].map((call, index) => ({ id: call.id || `call_${index}`, type: 'function', function: call.function,
      ...(call.thought_signature ? { thought_signature: call.thought_signature } : {}) }));
    if (family === 'claude' && schema) {
      const structured = toolCalls.find(call => call.function.name === (schema.name ?? 'structured_output'));
      if (structured) { state.content = structured.function.arguments; toolCalls.splice(toolCalls.indexOf(structured), 1); }
    }
    return reasoning || toolCalls.length ? { content: state.content,
      ...(state.reasoning ? { reasoning: state.reasoning } : {}),
      ...(state.reasoning_signature ? { reasoning_signature: state.reasoning_signature } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } : state.content;
  };
  return { state, accept, result };
}

async function readEventStream(response, accept, signal) {
  if (!response.body) throw new Error('模型流没有响应正文');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', data = [], event = '', finished = false;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const dispatch = async () => {
    if (!data.length) { event = ''; return; }
    const value = data.join('\n'); data = [];
    if (value.trim() === '[DONE]') { finished = true; return; }
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw new Error('模型事件流包含无效 JSON'); }
    finished = await accept(parsed, event); event = '';
  };
  const line = async value => {
    if (!value) return dispatch();
    if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    if (value.startsWith('event:')) event = value.slice(6).trim();
  };
  const drain = async final => {
    for (;;) {
      const match = /[\r\n]/.exec(buffer);
      if (!match || !final && match[0] === '\r' && match.index === buffer.length - 1) break;
      const value = buffer.slice(0, match.index), size = buffer.slice(match.index, match.index + 2) === '\r\n' ? 2 : 1;
      buffer = buffer.slice(match.index + size); await line(value);
      if (finished) return;
    }
    if (final && buffer) { await line(buffer); buffer = ''; }
    if (final && !finished) await dispatch();
  };
  try {
    signal?.throwIfAborted();
    while (!finished) {
      const { value, done } = await reader.read(); signal?.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      await drain(done);
      if (done) break;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

/** 自定义连接只在当前请求内使用，生成结果由调用方决定是否写入聊天。 */
export async function requestCustomGeneration({ messages, config = {}, settings = {}, signal, onProgress = async () => {}, fetchImpl = fetch }) {
  if (!Array.isArray(messages)) throw new TypeError('生成消息必须是数组');
  const api = { apiurl: settings.apiurl, key: settings.key, model: settings.model,
    source: settings.source ?? settings.chat_completion_source ?? 'openai',
    ...Object.fromEntries(Object.entries(config.custom_api ?? {}).filter(([, value]) => value !== undefined)) };
  const family = familyOf(api.source);
  const body = requestBody(messages, config, settings, api, family);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (family === 'claude') { headers.set('anthropic-version', '2023-06-01'); if (api.key) headers.set('x-api-key', api.key); }
  else if (family === 'google') { if (api.key) headers.set('x-goog-api-key', api.key); }
  else if (api.key) headers.set('Authorization', `Bearer ${api.key}`);
  if (api.source === 'custom') for (const [name, value] of Object.entries(api.custom_include_headers ?? {})) headers.set(name, String(value));
  signal?.throwIfAborted();
  const redact = text => api.key ? String(text).replaceAll(api.key, '[密钥]') : String(text);
  try {
    const response = await fetchImpl(endpoint(api, family, !!body.stream || !!config.should_stream && family === 'google'), { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(`模型请求失败：HTTP ${response.status} ${response.statusText}${detail ? '：' + detail : ''}`);
    }
    const output = responseAccumulator(family, config.json_schema);
    const accept = async (data, event) => {
      const before = output.state.content, previousReasoning = output.state.reasoning;
      const finished = output.accept(data, event);
      if (before !== output.state.content || previousReasoning !== output.state.reasoning) await onProgress({ content: output.state.content, reasoning: output.state.reasoning });
      signal?.throwIfAborted(); return finished;
    };
    if (response.headers.get('content-type')?.includes('text/event-stream')) await readEventStream(response, accept, signal);
    else {
      let data;
      try { data = await response.json(); } catch { signal?.throwIfAborted(); throw new Error('模型响应包含无效 JSON'); }
      await accept(data);
    }
    signal?.throwIfAborted();
    return output.result(!!config.should_return_reasoning);
  } catch (error) {
    if (signal?.aborted) { signal.throwIfAborted(); }
    if (api.key && error?.message?.includes(api.key)) throw new Error(redact(error.message));
    throw error;
  }
}
