// 从 SillyTavern 抽取并接入本项目上下文，修改日期 2026-10-25；来源与许可见 sources.json、LICENSE-ST。
import { regexFromString } from './utils.mjs';
export function createRegexEngine({ getRegexScripts, substituteParams, substituteParamsExtended, extension_settings, console }) {
class RegexProvider {
    /** @type {Map<string, RegExp>} */
    #cache = new Map();
    /** @type {number} */
    #maxSize = 1000;

    static instance = new RegexProvider();

    /**
     * Gets a regex instance by its string representation.
     * @param {string} regexString The regex string to retrieve
     * @returns {RegExp?} Compiled regex or null if invalid
     */
    get(regexString) {
        const isCached = this.#cache.has(regexString);
        const regex = isCached
            ? this.#cache.get(regexString)
            : regexFromString(regexString);

        if (!regex) {
            return null;
        }

        if (isCached) {
            // LRU: Move to end by re-inserting
            this.#cache.delete(regexString);
            this.#cache.set(regexString, regex);
        } else {
            // Evict oldest if at capacity
            if (this.#cache.size >= this.#maxSize) {
                const firstKey = this.#cache.keys().next().value;
                this.#cache.delete(firstKey);
            }
            this.#cache.set(regexString, regex);
        }

        // Reset lastIndex for global/sticky regexes
        if (regex.global || regex.sticky) {
            regex.lastIndex = 0;
        }

        return regex;
    }

    /**
     * Clears the entire cache.
     */
    clear() {
        this.#cache.clear();
    }
}

const regex_placement = {
    /**
     * @deprecated MD Display is deprecated. Do not use.
     */
    MD_DISPLAY: 0,
    USER_INPUT: 1,
    AI_OUTPUT: 2,
    SLASH_COMMAND: 3,
    // 4 - sendAs (legacy)
    WORLD_INFO: 5,
    REASONING: 6,
};

const substitute_find_regex = {
    NONE: 0,
    RAW: 1,
    ESCAPED: 2,
};

function sanitizeRegexMacro(x) {
    return (x && typeof x === 'string') ?
        x.replaceAll(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, function (s) {
            switch (s) {
                case '\n':
                    return '\\n';
                case '\r':
                    return '\\r';
                case '\t':
                    return '\\t';
                case '\v':
                    return '\\v';
                case '\f':
                    return '\\f';
                case '\0':
                    return '\\0';
                default:
                    return '\\' + s;
            }
        }) : x;
}

function getRegexedString(rawString, placement, { characterOverride, isMarkdown, isPrompt, isEdit, depth } = {}) {
    // WTF have you passed me?
    if (typeof rawString !== 'string') {
        console.warn('getRegexedString: rawString is not a string. Returning empty string.');
        return '';
    }

    let finalString = rawString;
    if (extension_settings.disabledExtensions.includes('regex') || !rawString || placement === undefined) {
        return finalString;
    }

    const allRegex = getRegexScripts({ allowedOnly: true });
    allRegex.forEach((script) => {
        if (
            // Script applies to Markdown and input is Markdown
            (script.markdownOnly && isMarkdown) ||
            // Script applies to Generate and input is Generate
            (script.promptOnly && isPrompt) ||
            // Script applies to all cases when neither "only"s are true, but there's no need to do it when `isMarkdown`, the as source (chat history) should already be changed beforehand
            (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)
        ) {
            if (isEdit && !script.runOnEdit) {
                console.debug(`getRegexedString: Skipping script ${script.scriptName} because it does not run on edit`);
                return;
            }

            // Check if the depth is within the min/max depth
            if (typeof depth === 'number') {
                if (!isNaN(script.minDepth) && script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) {
                    console.debug(`getRegexedString: Skipping script ${script.scriptName} because depth ${depth} is less than minDepth ${script.minDepth}`);
                    return;
                }

                if (!isNaN(script.maxDepth) && script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) {
                    console.debug(`getRegexedString: Skipping script ${script.scriptName} because depth ${depth} is greater than maxDepth ${script.maxDepth}`);
                    return;
                }
            }

            if (script.placement.includes(placement)) {
                finalString = runRegexScript(script, finalString, { characterOverride });
            }
        }
    });

    return finalString;
}

function runRegexScript(regexScript, rawString, { characterOverride } = {}) {
    let newString = rawString;
    if (!regexScript || !!(regexScript.disabled) || !regexScript?.findRegex || !rawString) {
        return newString;
    }

    const getRegexString = () => {
        switch (Number(regexScript.substituteRegex)) {
            case substitute_find_regex.NONE:
                return regexScript.findRegex;
            case substitute_find_regex.RAW:
                return substituteParamsExtended(regexScript.findRegex);
            case substitute_find_regex.ESCAPED:
                return substituteParamsExtended(regexScript.findRegex, {}, sanitizeRegexMacro);
            default:
                console.warn(`runRegexScript: Unknown substituteRegex value ${regexScript.substituteRegex}. Using raw regex.`);
                return regexScript.findRegex;
        }
    };
    const regexString = getRegexString();
    const findRegex = RegexProvider.instance.get(regexString);

    // The user skill issued. Return with nothing.
    if (!findRegex) {
        return newString;
    }

    // Run replacement. Currently does not support the Overlay strategy
    newString = rawString.replace(findRegex, function (match) {
        const args = [...arguments];
        const replaceString = regexScript.replaceString.replace(/{{match}}/gi, '$0');
        const replaceWithGroups = replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
            if (num) {
                // Handle numbered capture groups ($1, $2, etc.)
                match = args[Number(num)];
            } else if (groupName) {
                // Handle named capture groups ($<name>)
                const groups = args[args.length - 1];
                match = groups && typeof groups === 'object' && groups[groupName];
            }

            // No match found - return the empty string
            if (!match) {
                return '';
            }

            // Remove trim strings from the match
            const filteredMatch = filterString(match, regexScript.trimStrings, { characterOverride });

            return filteredMatch;
        });

        // Substitute at the end
        return substituteParams(replaceWithGroups);
    });

    return newString;
}

function filterString(rawString, trimStrings, { characterOverride } = {}) {
    let finalString = rawString;
    trimStrings.forEach((trimString) => {
        const subTrimString = substituteParams(trimString, { name2Override: characterOverride });
        finalString = finalString.replaceAll(subTrimString, '');
    });

    return finalString;
}
return { getRegexedString, runRegexScript, regex_placement };
}
