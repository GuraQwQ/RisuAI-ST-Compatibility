export const placeholderPromptDefaultOrder = ['world_info_before', 'persona_description', 'char_description',
  'char_personality', 'scenario', 'world_info_after', 'dialogue_examples', 'chat_history', 'user_input'];
const identifiers = { world_info_before: 'worldInfoBefore', persona_description: 'personaDescription',
  char_description: 'charDescription', char_personality: 'charPersonality', scenario: 'scenario',
  world_info_after: 'worldInfoAfter', dialogue_examples: 'dialogueExamples', chat_history: 'chatHistory' };

/** 独立生成只改快照，参数和临时历史不写回用户聊天。 */
export function applyGenerationConfig(snapshot, config = {}, raw = false) {
  const input = structuredClone(snapshot), overrides = config.overrides ?? {};
  input.templateChat = structuredClone(snapshot.chat);
  input.templateGreeting = snapshot.greeting;
  if (config.tools?.length && config.json_schema) throw new Error('tools 与 json_schema 不能同时使用');
  const data = input.card.data ?? input.card;
  for (const [name, field] of Object.entries({ char_description: 'description', char_personality: 'personality',
    scenario: 'scenario', dialogue_examples: 'mes_example' })) if (Object.hasOwn(overrides, name)) data[field] = overrides[name];
  if (Object.hasOwn(overrides, 'persona_description')) input.persona = overrides.persona_description;
  input.generationOverrides = structuredClone(overrides);
  input.generation = { config: structuredClone(config), raw };
  const history = overrides.chat_history?.prompts;
  if (history !== undefined) {
    if (!Array.isArray(history)) throw new TypeError('覆盖的聊天历史必须是数组');
    input.greeting = '';
    input.chat.stCompatibility = { ...input.chat.stCompatibility, greetingMaterialized: true };
    input.chat.message = history.map((prompt, index) => {
      if (!['system', 'user', 'assistant'].includes(prompt.role) || typeof prompt.content !== 'string') throw new TypeError('聊天历史提示词需要有效的 role 和 content');
      return { role: prompt.role === 'assistant' ? 'char' : prompt.role,
        data: prompt.content, image: prompt.image, chatId: `generation:${index}`, stCompatibility: { role: prompt.role } };
    });
  }
  if (config.max_chat_history !== undefined && config.max_chat_history !== 'all') {
    if (!Number.isInteger(config.max_chat_history) || config.max_chat_history < 0) throw new RangeError('max_chat_history 必须是非负整数或 all');
    const limit = config.max_chat_history;
    const hadGreeting = !input.chat.stCompatibility?.greetingMaterialized;
    const visible = [...(hadGreeting ? [{ role: 'char', data: input.greeting ?? data.first_mes ?? '', chatId: 'generation:greeting' }] : []),
      ...input.chat.message.filter(message => !message.disabled && !message.isComment)];
    input.chat.message = limit ? visible.slice(-limit) : [];
    input.chat.stCompatibility = { ...input.chat.stCompatibility, greetingMaterialized: true };
  }
  if (Object.hasOwn(overrides.chat_history ?? {}, 'author_note')) input.authorsNote = { ...input.authorsNote, content: overrides.chat_history.author_note };
  input.extensionPrompts ??= {};
  for (const [index, prompt] of (config.injects ?? []).entries()) {
    if (!['system', 'user', 'assistant'].includes(prompt.role) || typeof prompt.content !== 'string'
      || !Number.isInteger(prompt.depth) || prompt.depth < 0) throw new TypeError('注入提示词需要有效的 role、content 和 depth');
    input.extensionPrompts[prompt.id ?? `helper_inject_${index}`] = { value: prompt.content,
      position: prompt.position === 'none' ? -1 : 1, depth: prompt.depth,
      role: ['system', 'user', 'assistant'].indexOf(prompt.role), scan: prompt.should_scan ?? true };
  }
  const order = config.ordered_prompts ?? placeholderPromptDefaultOrder;
  if (!Array.isArray(order)) throw new TypeError('ordered_prompts 必须是数组');
  const separateInput = raw && order.includes('user_input');
  const hasInput = !!config.user_input || !!(Array.isArray(config.image) ? config.image.length : config.image);
  if (!separateInput && (!raw || order.includes('chat_history')) && hasInput) input.chat.message.push({ role: 'user', data: config.user_input ?? '', image: config.image, chatId: 'generation:user' });
  input.generationImages = {};
  input.chat.message.forEach((message, index) => {
    message.stIdentifier = `helper_history_${index}`;
    if (message.image) input.generationImages[message.stIdentifier] = message.image;
    else if (message.multimodals?.length) input.generationImages[message.stIdentifier] = message.multimodals.filter(item => item.type === 'image').map(item => item.data);
  });
  input.input = config.user_input ?? '';
  if (raw) {
    const requested = [...order];
    if (!separateInput && !order.includes('chat_history') && hasInput) requested.push('user_input');
    const prompts = requested.map((item, index) => {
      if (typeof item === 'string' && item !== 'user_input') {
        if (!Object.hasOwn(identifiers, item)) throw new Error(`未知内置提示词：${item}`);
        return { identifier: identifiers[item], name: item, marker: true, system_prompt: true, role: 'system' };
      }
      const prompt = item === 'user_input' ? { role: 'user', content: config.user_input ?? '', image: config.image } : item;
      if (!prompt || !['system', 'user', 'assistant'].includes(prompt.role) || typeof prompt.content !== 'string') throw new TypeError('自定义提示词需要有效的 role 和 content');
      return { ...prompt, identifier: `helper_raw_${index}`, name: `自定义提示词 ${index}`, enabled: true,
        system_prompt: false, injection_position: 0, forbid_overrides: true };
    });
    input.preset = { prompts, prompt_order: [{ character_id: 100001, order: prompts.map(prompt => ({ identifier: prompt.identifier, enabled: true })) }],
      new_chat_prompt: '', new_example_chat_prompt: '', send_if_empty: '', names_behavior: -1,
      personality_format: '{{personality}}', scenario_format: '{{scenario}}' };
    input.promptOrderId = 100001;
    Object.assign(input.generationImages, Object.fromEntries(prompts.filter(prompt => prompt.image).map(prompt => [prompt.identifier, prompt.image])));
  }
  return input;
}

/** Risu 的多模态字段在发送前转换，快照保留图片 URL，避免 Blob 进入 JSON RPC。 */
export function attachGenerationImages(messages, input) {
  return messages.map(({ stIdentifier, ...message }) => {
    const image = input.generationImages?.[stIdentifier];
    return image ? { ...message, multimodals: (Array.isArray(image) ? image : [image]).map(url => ({ type: 'image', data: url })) } : message;
  });
}
