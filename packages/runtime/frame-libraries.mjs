import _ from 'lodash';
import $ from 'jquery';
import * as z from 'zod';
import * as Vue from 'vue';
import * as VueRouter from 'vue-router';
import YAML from 'yaml';
import JSON5 from 'json5';
import { jsonrepair } from 'jsonrepair';
import { klona } from 'klona';
import toastr from 'toastr';
import showdown from 'showdown';
import { createRegexEngine } from '../core/vendor/regex.mjs';
import { createFrontendTemplate } from '../core/frontend-template.mjs';
const markdown = new showdown.Converter();
Object.assign(globalThis, { _, $, jQuery: $, z, Vue, VueRouter, YAML, JSON5, jsonrepair, klona, toastr });
globalThis.__stFrontendEnvironment = {
  _, makeTemplate: createFrontendTemplate, markdown: text => markdown.makeHtml(text),
  formatRegex(text, source, destination, options, api) {
    const placement = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 }[source];
    const regexes = ['global', 'preset', 'character'].flatMap(type => api.getTavernRegexes({ type })).map(regex => ({
      id: regex.id, scriptName: regex.script_name, findRegex: regex.find_regex, replaceString: regex.replace_string,
      trimStrings: regex.trim_strings, disabled: !regex.enabled, minDepth: regex.min_depth, maxDepth: regex.max_depth,
      markdownOnly: regex.destination.display, promptOnly: regex.destination.prompt, runOnEdit: regex.run_on_edit,
      placement: Object.entries(regex.source).filter(([, enabled]) => enabled).map(([name]) => ({ user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 })[name]),
    }));
    const engine = createRegexEngine({ getRegexScripts: () => regexes, substituteParams: api.substitudeMacros,
      substituteParamsExtended: api.substitudeMacros, extension_settings: { disabledExtensions: [] }, console });
    return engine.getRegexedString(text, placement, { isMarkdown: destination === 'display', isPrompt: destination === 'prompt',
      isEdit: options.is_edit ?? false, depth: options.depth });
  },
};
