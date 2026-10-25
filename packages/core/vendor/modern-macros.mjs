// 从固定版本 SillyTavern 抽取宏引擎，修改日期 2026-10-25；来源与许可见 modern-sources.json、LICENSE-ST。
import * as chevrotain from 'chevrotain';
import seedrandom from 'seedrandom';
import droll from 'droll';
import moment from 'moment';
export function createModernMacroEngine(hostContext) {
const SillyTavern={getContext:()=>hostContext},console=hostContext.console;
const document={querySelector:selector=>selector==='#send_textarea'?{value:hostContext.input??''}:null};
var STModernMacros = (function(exports, chevrotain, seedrandom, droll, moment) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	// \0rolldown/runtime.js
	var __create = Object.create;
	var __defProp = Object.defineProperty;
	var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
	var __getOwnPropNames = Object.getOwnPropertyNames;
	var __getProtoOf = Object.getPrototypeOf;
	var __hasOwnProp = Object.prototype.hasOwnProperty;
	var __copyProps = (to, from, except, desc) => {
		if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
			key = keys[i];
			if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
				get: ((k) => from[k]).bind(null, key),
				enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
			});
		}
		return to;
	};
	var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
		value: mod,
		enumerable: true
	}) : target, mod));
	chevrotain = __toESM(chevrotain);
	seedrandom = __toESM(seedrandom);
	droll = __toESM(droll);
	let moment$3 = __toESM(moment, 1);
	moment = __toESM(moment);
	// packages/core/vendor/utils.mjs
	function getStringHash(str, seed = 0) {
		if (typeof str !== "string") return 0;
		let h1 = 3735928559 ^ seed, h2 = 1103547991 ^ seed;
		for (let i = 0, ch; i < str.length; i++) {
			ch = str.charCodeAt(i);
			h1 = Math.imul(h1 ^ ch, 2654435761);
			h2 = Math.imul(h2 ^ ch, 1597334677);
		}
		h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
		h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
		return 4294967296 * (2097151 & h2) + (h1 >>> 0);
	}
	function isTrueBoolean(arg) {
		return [
			"on",
			"true",
			"1"
		].includes(arg?.trim()?.toLowerCase());
	}
	function isFalseBoolean(arg) {
		return [
			"off",
			"false",
			"0"
		].includes(arg?.trim()?.toLowerCase());
	}
	// \0st-macro-host
	var chat = hostContext.chat;
	var chat_metadata = hostContext.metadata;
	var power_user = { instruct: { enabled: false } };
	var getMaxContextTokens = () => hostContext.maxContext ?? 8192;
	var getMaxResponseTokens = () => hostContext.maxResponse ?? 0;
	var getMaxPromptTokens = () => getMaxContextTokens() - getMaxResponseTokens();
	var getCurrentChatId = () => hostContext.chatId;
	var extension_prompts = hostContext.extensionPrompts ?? {};
	var inject_ids = { CUSTOM_WI_OUTLET: (name) => "customWIOutlet_" + name };
	var isMobile = () => false;
	var formatInstructModeExamples = () => [];
	var parseMesExamples = hostContext.parseMesExamples;
	var timestampToMoment = (value) => hostContext.timestampToMoment(value);
	// cache/upstream/sillytavern/public/scripts/macros/engine/MacroLexer.js
	var { createToken, Lexer } = chevrotain;
	/** @typedef {import('chevrotain').TokenType} TokenType */
	/** Regex for lexer token matching (no anchors). */
	var IDENTIFIER_LEXER_PATTERN = /[a-zA-Z][\w-_]*/;
	/**
	* Pattern for valid macro identifiers.
	* Must start with a letter, followed by word chars (letters, digits, underscore) or hyphens.
	* Used by both the lexer token and the validation regex.
	*
	* Regex for full-string validation (with anchors). Exported for macro registration.
	*/
	var MACRO_IDENTIFIER_PATTERN = /^[a-zA-Z][\w-_]*$/;
	/**
	* Pattern for valid variable shorthand identifiers.
	* Must start with a letter, followed by word chars (letters, digits, underscore) or hyphens,
	* but must end with a word character (not a hyphen).
	*
	* Used for variable shorthand syntax like .varName or $varName.
	*/
	var MACRO_VARIABLE_SHORTHAND_PATTERN = /[a-zA-Z](?:[\w\-_]*[\w])?/;
	/** @enum {string} */
	var modes = Object.freeze({
		plaintext: "plaintext_mode",
		macro_def: "macro_def_mode",
		macro_identifier_end: "macro_identifier_end_mode",
		macro_args: "macro_args_mode",
		macro_filter_modifer: "macro_filter_modifer_mode",
		macro_filter_modifier_end: "macro_filter_modifier_end_mode",
		var_identifier: "var_identifier_mode",
		var_after_identifier: "var_after_identifier_mode",
		var_value: "var_value_mode"
	});
	/**
	* All lexer tokens used by the macro parser.
	* @readonly
	*/
	var Tokens = Object.freeze({
		/** General capture-all plaintext without macros. Consumes any character that is not the first '{' of a macro opener '{{'. */
		Plaintext: createToken({
			name: "Plaintext",
			pattern: /(?:[^{]|\{(?!\{))+/u,
			line_breaks: true
		}),
		/** Single literal '{' that appears immediately before a macro opener '{{' */
		PlaintextOpenBrace: createToken({
			name: "Plaintext.OpenBrace",
			pattern: /\{(?=\{\{)/
		}),
		/** General macro capture */
		Macro: {
			Start: createToken({
				name: "Macro.Start",
				pattern: /\{\{/
			}),
			/**
			* Macro execution flags - special symbols that modify macro resolution behavior.
			* - `!` = immediate resolve (TBD)
			* - `?` = delayed resolve (TBD)
			* - `~` = re-evaluate (TBD)
			* - `/` = closing block marker for scoped macros
			* - `#` = preserve whitespace (don't auto-trim scoped content), also legacy handlebars compatibility
			*/
			Flags: createToken({
				name: "Macro.Flag",
				pattern: /[!?~#/]/
			}),
			/**
			* Filter flag (`>`) - separate token because it changes parsing behavior.
			* When present, `|` characters inside the macro are treated as filter/pipe operators.
			*/
			FilterFlag: createToken({
				name: "Macro.FilterFlag",
				pattern: />/
			}),
			DoubleSlash: createToken({
				name: "Macro.DoubleSlash",
				pattern: /\/\//
			}),
			/**
			* Separate macro identifier needed, that is similar to the global indentifier, but captures the actual macro "name"
			* We need this, because this token is going to switch lexer mode, while the general identifier does not.
			*/
			Identifier: createToken({
				name: "Macro.Identifier",
				pattern: IDENTIFIER_LEXER_PATTERN
			}),
			/** At the end of an identifier, there has to be whitspace, or must be directly followed by colon/double-colon separator, output modifier or closing braces */
			EndOfIdentifier: createToken({
				name: "Macro.EndOfIdentifier",
				pattern: /(?:\s+|(?=:{1,2})|(?=[|}]))/,
				group: Lexer.SKIPPED
			}),
			BeforeEnd: createToken({
				name: "Macro.BeforeEnd",
				pattern: /(?=\}\})/,
				group: Lexer.SKIPPED
			}),
			End: createToken({
				name: "Macro.End",
				pattern: /\}\}/
			})
		},
		/** Captures that only appear inside arguments */
		Args: {
			DoubleColon: createToken({
				name: "Args.DoubleColon",
				pattern: /::/
			}),
			Colon: createToken({
				name: "Args.Colon",
				pattern: /:/
			}),
			Equals: createToken({
				name: "Args.Equals",
				pattern: /=/
			}),
			Quote: createToken({
				name: "Args.Quote",
				pattern: /"/
			})
		},
		Filter: {
			EscapedPipe: createToken({
				name: "Filter.EscapedPipe",
				pattern: /\\\|/
			}),
			Pipe: createToken({
				name: "Filter.Pipe",
				pattern: /\|/
			}),
			Identifier: createToken({
				name: "Filter.Identifier",
				pattern: IDENTIFIER_LEXER_PATTERN
			}),
			/** At the end of an identifier, there has to be whitspace, or must be directly followed by colon/double-colon separator, output modifier or closing braces */
			EndOfIdentifier: createToken({
				name: "Filter.EndOfIdentifier",
				pattern: /(?:\s+|(?=:{1,2})|(?=[|}]))/,
				group: Lexer.SKIPPED
			})
		},
		Identifier: createToken({
			name: "Identifier",
			pattern: IDENTIFIER_LEXER_PATTERN
		}),
		WhiteSpace: createToken({
			name: "WhiteSpace",
			pattern: /\s+/,
			group: Lexer.SKIPPED
		}),
		/** Variable shorthand tokens */
		Var: {
			/** Local variable prefix (`.`) - triggers variable shorthand for local variables */
			LocalPrefix: createToken({
				name: "Var.LocalPrefix",
				pattern: /\./
			}),
			/** Global variable prefix (`$`) - triggers variable shorthand for global variables */
			GlobalPrefix: createToken({
				name: "Var.GlobalPrefix",
				pattern: /\$/
			}),
			/**
			* Variable identifier - allows hyphens inside but not at the end to avoid conflict with -- operator.
			* Pattern: starts with letter, optionally followed by word chars/hyphens, but must end with word char.
			* Examples: myVar, my-var, my_var, myVar123, my-long-var-name
			* Invalid: my-, my--, -var
			*/
			Identifier: createToken({
				name: "Var.Identifier",
				pattern: MACRO_VARIABLE_SHORTHAND_PATTERN
			}),
			/** All tokens that are valid operators inside a variable shorthand expression */
			Operators: {
				/** Increment operator (`++`) */
				Increment: createToken({
					name: "Var.Increment",
					pattern: /\+\+/
				}),
				/** Decrement operator (`--`) */
				Decrement: createToken({
					name: "Var.Decrement",
					pattern: /--/
				}),
				/** Nullish coalescing assignment operator (`??=`) - sets var if undefined, must come before NullishCoalescing */
				NullishCoalescingEquals: createToken({
					name: "Var.NullishCoalescingEquals",
					pattern: /\?\?=/
				}),
				/** Nullish coalescing operator (`??`) - returns default if var undefined */
				NullishCoalescing: createToken({
					name: "Var.NullishCoalescing",
					pattern: /\?\?/
				}),
				/** Logical OR assignment operator (`||=`) - sets var if falsy, must come before LogicalOr */
				LogicalOrEquals: createToken({
					name: "Var.LogicalOrEquals",
					pattern: /\|\|=/
				}),
				/** Logical OR operator (`||`) - returns default if var falsy */
				LogicalOr: createToken({
					name: "Var.LogicalOr",
					pattern: /\|\|/
				}),
				/** Subtract operator (`-=`) - subtracts value from variable */
				MinusEquals: createToken({
					name: "Var.MinusEquals",
					pattern: /-=/
				}),
				/** Equality comparison operator (`==`) - compares variable to value */
				DoubleEquals: createToken({
					name: "Var.DoubleEquals",
					pattern: /==/
				}),
				/** Not equals comparison operator (`!=`) - compares variable to value, returns inverted result */
				NotEquals: createToken({
					name: "Var.NotEquals",
					pattern: /!=/
				}),
				/** Greater than or equal comparison operator (`>=`) - must come before GreaterThan */
				GreaterThanOrEqual: createToken({
					name: "Var.GreaterThanOrEqual",
					pattern: />=/
				}),
				/** Greater than comparison operator (`>`) */
				GreaterThan: createToken({
					name: "Var.GreaterThan",
					pattern: />/
				}),
				/** Less than or equal comparison operator (`<=`) - must come before LessThan */
				LessThanOrEqual: createToken({
					name: "Var.LessThanOrEqual",
					pattern: /<=/
				}),
				/** Less than comparison operator (`<`) */
				LessThan: createToken({
					name: "Var.LessThan",
					pattern: /</
				}),
				/** Add/append operator (`+=`) - must come before Equals to avoid conflict */
				PlusEquals: createToken({
					name: "Var.PlusEquals",
					pattern: /\+=/
				}),
				/** Set operator (`=`) */
				Equals: createToken({
					name: "Var.Equals",
					pattern: /=/
				})
			}
		},
		/**
		* Capture unknown characters one by one, to still allow other tokens being matched once they are there.
		* This includes any possible braces that is not the double closing braces as MacroEnd.
		*/
		Unknown: createToken({
			name: "Unknown",
			pattern: /([^}]|\}(?!\}))/
		}),
		/** TODO: Capture-all rest for now, that is not the macro end or opening of a new macro. Might be replaced later down the line. */
		Text: createToken({
			name: "Text",
			pattern: /.+(?=\}\}|\{\{)/,
			line_breaks: true
		}),
		/**
		* DANGER ZONE: Careful with this token. This is used as a way to pop the current mode, if no other token matches.
		* Can be used in modes that don't have a "defined" end really, like when capturing a single argument, argument list, etc.
		* Has to ALWAYS be the last token.
		*/
		ModePopper: createToken({
			name: "ModePopper",
			pattern: () => [""],
			line_breaks: false,
			group: Lexer.SKIPPED
		})
	});
	/** @type {Map<string,string>} Saves all token definitions that are marked as entering modes */
	var enterModesMap = /* @__PURE__ */ new Map();
	/**
	* Lexer definition object that maps states/modes to their token rules.
	* Each mode defines which tokens are valid in that context and how to transition between modes.
	* @readonly
	*/
	var Def = {
		modes: {
			[modes.plaintext]: [
				using(Tokens.Plaintext),
				using(Tokens.PlaintextOpenBrace),
				enter(Tokens.Macro.Start, modes.macro_def)
			],
			[modes.macro_def]: [
				exits(Tokens.Macro.End, modes.macro_def),
				enter(Tokens.Macro.DoubleSlash, modes.macro_args),
				enter(Tokens.Var.LocalPrefix, modes.var_identifier),
				enter(Tokens.Var.GlobalPrefix, modes.var_identifier),
				using(Tokens.Macro.Flags),
				using(Tokens.Macro.FilterFlag),
				using(Tokens.WhiteSpace),
				enter(Tokens.Macro.Identifier, modes.macro_identifier_end),
				exits(Tokens.ModePopper, modes.macro_def)
			],
			[modes.macro_identifier_end]: [exits(Tokens.Macro.BeforeEnd, modes.macro_identifier_end), enter(Tokens.Macro.EndOfIdentifier, modes.macro_args, { andExits: modes.macro_identifier_end })],
			[modes.macro_args]: [
				enter(Tokens.Macro.Start, modes.macro_def),
				using(Tokens.Args.DoubleColon),
				using(Tokens.Args.Colon),
				using(Tokens.Args.Equals),
				using(Tokens.Args.Quote),
				using(Tokens.Identifier),
				using(Tokens.WhiteSpace),
				using(Tokens.Unknown),
				exits(Tokens.ModePopper, modes.macro_args)
			],
			[modes.macro_filter_modifer]: [using(Tokens.WhiteSpace), enter(Tokens.Filter.Identifier, modes.macro_filter_modifier_end, { andExits: modes.macro_filter_modifer })],
			[modes.macro_filter_modifier_end]: [exits(Tokens.Macro.BeforeEnd, modes.macro_identifier_end), exits(Tokens.Filter.EndOfIdentifier, modes.macro_filter_modifer)],
			[modes.var_identifier]: [
				using(Tokens.WhiteSpace),
				enter(Tokens.Var.Identifier, modes.var_after_identifier, { andExits: modes.var_identifier }),
				exits(Tokens.ModePopper, modes.var_identifier)
			],
			[modes.var_after_identifier]: [
				using(Tokens.WhiteSpace),
				using(Tokens.Var.Operators.Increment),
				using(Tokens.Var.Operators.Decrement),
				enter(Tokens.Var.Operators.NullishCoalescingEquals, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.NullishCoalescing, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.LogicalOrEquals, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.LogicalOr, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.MinusEquals, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.DoubleEquals, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.NotEquals, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.GreaterThanOrEqual, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.GreaterThan, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.LessThanOrEqual, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.LessThan, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.PlusEquals, modes.var_value, { andExits: modes.var_after_identifier }),
				enter(Tokens.Var.Operators.Equals, modes.var_value, { andExits: modes.var_after_identifier }),
				exits(Tokens.Macro.BeforeEnd, modes.var_after_identifier),
				exits(Tokens.ModePopper, modes.var_after_identifier)
			],
			[modes.var_value]: [
				enter(Tokens.Macro.Start, modes.macro_def),
				using(Tokens.Identifier),
				using(Tokens.WhiteSpace),
				using(Tokens.Unknown),
				exits(Tokens.ModePopper, modes.var_value)
			]
		},
		defaultMode: modes.plaintext
	};
	/**
	* The singleton instance of the MacroLexer.
	*
	* @type {MacroLexer}
	*/
	var instance$4 = class MacroLexer extends Lexer {
		/** @type {MacroLexer} */ static #instance;
		/** @type {MacroLexer} */ static get instance() {
			return MacroLexer.#instance ?? (MacroLexer.#instance = new MacroLexer());
		}
		/** @readonly */ static tokens = Tokens;
		/** @readonly */ static def = Def;
		/** @readonly */ tokens = Tokens;
		/** @readonly */ def = MacroLexer.def;
		/** @private */
		constructor() {
			super(MacroLexer.def, { traceInitPerf: false });
		}
		test(input) {
			const result = this.tokenize(input);
			return {
				errors: result.errors,
				groups: result.groups,
				tokens: result.tokens.map(({ tokenType, ...rest }) => ({
					type: tokenType.name,
					...rest,
					tokenType
				}))
			};
		}
	}.instance;
	/**
	* [Utility]
	* Set push mode on the token definition.
	* Can be used inside the token mode definition block.
	*
	* Marks the token to **enter** the following lexer mode.
	*
	* Optionally, you can specify the modes to exit when entering this mode.
	*
	* @param {TokenType} token - The token to modify
	* @param {string} mode - The mode to set
	* @param {object} [options={}] - Additional options
	* @param {string} [options.andExits] - The modes to exit when entering this mode
	* @returns {TokenType} The token again
	*/
	function enter(token, mode, { andExits = void 0 } = {}) {
		if (!token) throw new Error("Token must not be undefined");
		if (enterModesMap.has(token.name) && enterModesMap.get(token.name) !== mode) throw new Error(`Token ${token.name} already is set to enter mode ${enterModesMap.get(token.name)}. The token definition are global, so they cannot be used to lead to different modes.`);
		if (andExits) exits(token, andExits);
		token.PUSH_MODE = mode;
		enterModesMap.set(token.name, mode);
		return token;
	}
	/**
	* [Utility]
	* Set pop mode on the token definition.
	* Can be used inside the token mode definition block.
	*
	* Marks the token to **exit** the following lexer mode.
	*
	* @param {TokenType} token - The token to modify
	* @param {string} mode - The mode to leave
	* @returns {TokenType} The token again
	*/
	function exits(token, mode) {
		if (!token) throw new Error("Token must not be undefined");
		token.POP_MODE = !!mode;
		return token;
	}
	/**
	* [Utility]
	* Can be used inside the token mode definition block.
	*
	* Marks the token to to just be used/consumed, and not exit or enter a mode.
	*
	* @param {TokenType} token - The token to modify
	* @returns {TokenType} The token again
	*/
	function using(token) {
		if (!token) throw new Error("Token must not be undefined");
		if (enterModesMap.has(token.name)) throw new Error(`Token ${token.name} is already marked to enter a mode (${enterModesMap.get(token.name)}). The token definition are global, so they cannot be used to lead or stay differently.`);
		return token;
	}
	// cache/upstream/sillytavern/public/scripts/macros/engine/MacroParser.js
	var { CstParser } = chevrotain;
	/** @typedef {import('chevrotain').TokenType} TokenType */
	/** @typedef {import('chevrotain').CstNode} CstNode */
	/** @typedef {import('chevrotain').ILexingError} ILexingError */
	/** @typedef {import('chevrotain').IRecognitionException} IRecognitionException */
	/**
	* The singleton instance of the MacroParser.
	*
	* @type {MacroParser}
	*/
	var instance$3 = class MacroParser extends CstParser {
		/** @type {MacroParser} */ static #instance;
		/** @type {MacroParser} */ static get instance() {
			return MacroParser.#instance ?? (MacroParser.#instance = new MacroParser());
		}
		/** @private */
		constructor() {
			super(instance$4.def, {
				traceInitPerf: false,
				nodeLocationTracking: "full",
				recoveryEnabled: true
			});
			const Tokens = instance$4.tokens;
			const $ = this;
			$.document = $.RULE("document", () => {
				$.MANY(() => {
					$.OR([
						{ ALT: () => $.CONSUME(Tokens.Plaintext, { LABEL: "plaintext" }) },
						{ ALT: () => $.CONSUME(Tokens.PlaintextOpenBrace, { LABEL: "plaintext" }) },
						{ ALT: () => $.SUBRULE($.macro) },
						{ ALT: () => $.CONSUME(Tokens.Macro.Start, { LABEL: "plaintext" }) }
					]);
				});
			});
			$.macro = $.RULE("macro", () => {
				$.CONSUME(Tokens.Macro.Start);
				$.MANY(() => {
					$.OR1([{ ALT: () => $.CONSUME(Tokens.Macro.Flags, { LABEL: "flags" }) }, { ALT: () => $.CONSUME(Tokens.Macro.FilterFlag, { LABEL: "flags" }) }]);
				});
				$.OR([{ ALT: () => $.SUBRULE($.variableExpr) }, { ALT: () => $.SUBRULE($.macroBody) }]);
				$.CONSUME(Tokens.Macro.End);
			});
			$.macroBody = $.RULE("macroBody", () => {
				$.OR2([{ ALT: () => $.CONSUME(Tokens.Macro.DoubleSlash, { LABEL: "Macro.identifier" }) }, { ALT: () => $.CONSUME(Tokens.Macro.Identifier, { LABEL: "Macro.identifier" }) }]);
				$.OPTION(() => $.SUBRULE($.arguments));
			});
			$.variableExpr = $.RULE("variableExpr", () => {
				$.OR3([{ ALT: () => $.CONSUME(Tokens.Var.LocalPrefix, { LABEL: "Var.scope" }) }, { ALT: () => $.CONSUME(Tokens.Var.GlobalPrefix, { LABEL: "Var.scope" }) }]);
				$.CONSUME(Tokens.Var.Identifier, { LABEL: "Var.identifier" });
				$.OPTION2(() => $.SUBRULE($.variableOperator));
			});
			$.variableOperator = $.RULE("variableOperator", () => {
				$.OR4([
					{ ALT: () => $.CONSUME(Tokens.Var.Operators.Increment, { LABEL: "Var.operator" }) },
					{ ALT: () => $.CONSUME(Tokens.Var.Operators.Decrement, { LABEL: "Var.operator" }) },
					{ ALT: () => {
						$.OR5([
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.NullishCoalescingEquals, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.NullishCoalescing, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.LogicalOrEquals, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.LogicalOr, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.MinusEquals, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.DoubleEquals, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.NotEquals, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.GreaterThanOrEqual, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.GreaterThan, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.LessThanOrEqual, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.LessThan, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.PlusEquals, { LABEL: "Var.operator" }) },
							{ ALT: () => $.CONSUME(Tokens.Var.Operators.Equals, { LABEL: "Var.operator" }) }
						]);
						$.SUBRULE($.variableValue, { LABEL: "Var.value" });
					} }
				]);
			});
			$.variableValue = $.RULE("variableValue", () => {
				$.MANY2(() => {
					$.OR5([
						{ ALT: () => $.SUBRULE($.macro) },
						{ ALT: () => $.CONSUME(Tokens.Identifier) },
						{ ALT: () => $.CONSUME(Tokens.Unknown) }
					]);
				});
			});
			$.arguments = $.RULE("arguments", () => {
				$.OR([{ ALT: () => {
					$.CONSUME(Tokens.Args.DoubleColon, { LABEL: "separator" });
					$.AT_LEAST_ONE_SEP({
						SEP: Tokens.Args.DoubleColon,
						DEF: () => $.SUBRULE($.argument, { LABEL: "argument" })
					});
				} }, {
					ALT: () => {
						$.OPTION(() => {
							$.CONSUME(Tokens.Args.Colon, { LABEL: "separator" });
						});
						$.SUBRULE($.argumentAllowingColons, { LABEL: "argument" });
					},
					IGNORE_AMBIGUITIES: true
				}]);
			});
			const validArgumentTokens = [
				{ ALT: () => $.SUBRULE($.macro) },
				{ ALT: () => $.CONSUME(Tokens.Identifier) },
				{ ALT: () => $.CONSUME(Tokens.Unknown) },
				{ ALT: () => $.CONSUME(Tokens.Args.Colon) },
				{ ALT: () => $.CONSUME(Tokens.Args.Equals) },
				{ ALT: () => $.CONSUME(Tokens.Args.Quote) }
			];
			$.argument = $.RULE("argument", () => {
				$.MANY(() => {
					$.OR([...validArgumentTokens]);
				});
			});
			$.argumentAllowingColons = $.RULE("argumentAllowingColons", () => {
				$.AT_LEAST_ONE(() => {
					$.OR([...validArgumentTokens, { ALT: () => $.CONSUME(Tokens.Args.DoubleColon) }]);
				});
			});
			this.performSelfAnalysis();
		}
		/**
		* Parses a document into a CST.
		*
		* @param {string} input
		* @returns {{ cst: CstNode|null, errors: ({ message: string }|ILexingError|IRecognitionException)[] , lexingErrors: ILexingError[], parserErrors: IRecognitionException[] }}
		*/
		parseDocument(input) {
			if (!input) return {
				cst: null,
				errors: [{ message: "Input is empty" }],
				lexingErrors: [],
				parserErrors: []
			};
			const lexingResult = instance$4.tokenize(input);
			this.input = lexingResult.tokens;
			return {
				cst: this.document(),
				errors: [...lexingResult.errors, ...this.errors],
				lexingErrors: lexingResult.errors,
				parserErrors: this.errors
			};
		}
		test(input) {
			const lexingResult = instance$4.tokenize(input);
			this.input = lexingResult.tokens;
			return {
				cst: this.macro(),
				errors: this.errors.map((x) => ({
					message: x.message,
					...x,
					stack: x.stack
				}))
			};
		}
	}.instance;
	// cache/upstream/sillytavern/public/scripts/macros/engine/MacroDiagnostics.js
	function createMacroRuntimeError({ message, call, def, macroName }) {
		const inferredName = inferMacroName(call, def, macroName);
		const error = new Error(message);
		error.name = "MacroRuntimeError";
		error.isMacroRuntimeError = true;
		error.macroName = inferredName;
		error.macroRange = call && call.range ? call.range : null;
		if (call) error.macroCall = call;
		if (def) error.macroDefinition = def;
		return error;
	}
	function logMacroRuntimeWarning({ message, call, def, macroName, error }) {
		const payload = buildMacroPayload({
			call,
			def,
			macroName,
			error
		});
		console.warn("[Macro] Warning:", message, payload);
	}
	function logMacroInternalError({ message, call, macroName, error }) {
		const payload = buildMacroPayload({
			call,
			def: void 0,
			macroName,
			error
		});
		console.error("[Macro] Error:", message, payload);
	}
	function logMacroRegisterWarning({ message, macroName, error = void 0 }) {
		const payload = buildMacroPayload({
			macroName,
			error
		});
		console.warn("[Macro] Warning:", message, payload);
	}
	function logMacroRegisterError({ message, macroName, error = void 0 }) {
		const payload = buildMacroPayload({
			macroName,
			error
		});
		console.error("[Macro] Registration Error:", message, payload);
	}
	function logMacroGeneralError({ message, error }) {
		console.error("[Macro] Error:", message, error);
	}
	function logMacroSyntaxWarning({ phase, input, errors }) {
		if (!errors || errors.length === 0) return;
		/** @type {{ message: string, line: number|null, column: number|null, length: number|null }[]} */
		const issues = errors.map((err) => {
			const hasOwnLine = typeof err.line === "number";
			const hasOwnColumn = typeof err.column === "number";
			const token = err.token;
			const line = hasOwnLine ? err.line : token && typeof token.startLine === "number" ? token.startLine : null;
			const column = hasOwnColumn ? err.column : token && typeof token.startColumn === "number" ? token.startColumn : null;
			/** @type {number|null} */
			let length = null;
			if (typeof err.length === "number") length = err.length;
			else if (token && typeof token.startOffset === "number" && typeof token.endOffset === "number") length = token.endOffset - token.startOffset + 1;
			return {
				message: err.message,
				line,
				column,
				length
			};
		});
		const label = phase === "lexing" ? "Lexing" : "Parsing";
		/** @type {Record<string, any>} */
		const payload = {
			phase,
			count: issues.length,
			issues,
			input
		};
		console.warn("[Macro] Warning:", `${label} errors detected`, payload);
	}
	function buildMacroPayload({ call, def, macroName, error }) {
		/** @type {Record<string, any>} */
		const payload = { macroName: inferMacroName(call, def, macroName) };
		if (call && call.range) payload.range = call.range;
		if (call && typeof call.rawInner === "string") payload.raw = call.rawInner;
		if (call) payload.call = call;
		if (def) payload.def = def;
		if (error) payload.error = error;
		return payload;
	}
	function inferMacroName(call, def, explicit) {
		if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
		if (call && typeof call.name === "string" && call.name.trim()) return call.name.trim();
		if (def && typeof def.name === "string" && def.name.trim()) return def.name.trim();
		return "unknown";
	}
	// cache/upstream/sillytavern/public/scripts/macros/engine/MacroFlags.js
	/**
	* Macro Execution Flags - modifiers that change how macros are resolved at runtime.
	*
	* Flags are special symbols placed between the opening braces `{{` and the macro identifier.
	* Example: `{{!user}}` - the `!` is an "immediate resolve" flag.
	*
	* Multiple flags can be combined: `{{!?myMacro}}` or `{{ ! ? myMacro }}`
	*/
	/**
	* @typedef {Object} MacroFlags
	* @property {boolean} immediate - Whether the immediate (`!`) flag is set.
	* @property {boolean} delayed - Whether the delayed (`?`) flag is set.
	* @property {boolean} reevaluate - Whether the re-evaluate (`~`) flag is set.
	* @property {boolean} filter - Whether the filter (`>`) flag is set.
	* @property {boolean} closingBlock - Whether the closing block (`/`) flag is set.
	* @property {boolean} preserveWhitespace - Whether the preserve whitespace (`#`) flag is set.
	* @property {string[]} raw - The raw flag symbols in order of appearance.
	*/
	/**
	* Enum of all recognized macro execution flags.
	*
	* @readonly
	* @enum {string}
	*/
	var MacroFlagType = Object.freeze({
		/**
		* Immediate resolve flag (`!`).
		* This macro will be resolved first (in order of appearance) before "normal" macros.
		* @status TBD - Not implemented in v1
		*/
		IMMEDIATE: "!",
		/**
		* Delayed resolve flag (`?`).
		* This macro will be resolved last (in order of appearance) after "normal" macros.
		* @status TBD - Not implemented in v1
		*/
		DELAYED: "?",
		/**
		* Re-evaluate flag (`~`).
		* Marks a macro for potential re-evaluation.
		* @status TBD - Not implemented in v1
		*/
		REEVALUATE: "~",
		/**
		* Filter/pipe flag (`>`).
		* Indicates that this macro should resolve `|` characters as output filters.
		* @status Parsed - Filter feature not yet implemented
		*/
		FILTER: ">",
		/**
		* Closing block flag (`/`).
		* Marks this macro as the closing block of a scoped macro with the same identifier.
		* A closing block macro does not support arguments itself.
		* Example: `{{setvar::myvar}}long text{{/setvar}}`
		* @status Implemented - Content between opening and closing tags becomes the last unnamed argument
		*/
		CLOSING_BLOCK: "/",
		/**
		* Preserve whitespace flag (`#`).
		* Prevents automatic trimming of scoped content.
		* By default, scoped macro content is trimmed. Use this flag to preserve leading/trailing whitespace.
		* Also provides backwards compatibility with legacy handlebars-style syntax like `{{#if ...}}`.
		* Example: `{{#setvar::myvar}}  content with spaces  {{/setvar}}`
		* @status Implemented - Prevents auto-trim on scoped content
		*/
		PRESERVE_WHITESPACE: "#"
	});
	MacroFlagType.IMMEDIATE, MacroFlagType.IMMEDIATE, MacroFlagType.DELAYED, MacroFlagType.DELAYED, MacroFlagType.REEVALUATE, MacroFlagType.REEVALUATE, MacroFlagType.FILTER, MacroFlagType.FILTER, MacroFlagType.CLOSING_BLOCK, MacroFlagType.CLOSING_BLOCK, MacroFlagType.PRESERVE_WHITESPACE, MacroFlagType.PRESERVE_WHITESPACE;
	new Set(Object.values(MacroFlagType));
	/**
	* Creates a default MacroFlags object with all flags set to false.
	*
	* @returns {MacroFlags}
	*/
	function createEmptyFlags() {
		return {
			immediate: false,
			delayed: false,
			reevaluate: false,
			filter: false,
			closingBlock: false,
			preserveWhitespace: false,
			raw: []
		};
	}
	/**
	* Parses an array of flag symbols into a MacroFlags object.
	*
	* @param {string[]} flagSymbols - Array of flag symbol strings (e.g., ['!', '?']).
	* @returns {MacroFlags}
	*/
	function parseFlags(flagSymbols) {
		const flags = createEmptyFlags();
		for (const symbol of flagSymbols) {
			switch (symbol) {
				case MacroFlagType.IMMEDIATE:
					flags.immediate = true;
					break;
				case MacroFlagType.DELAYED:
					flags.delayed = true;
					break;
				case MacroFlagType.REEVALUATE:
					flags.reevaluate = true;
					break;
				case MacroFlagType.FILTER:
					flags.filter = true;
					break;
				case MacroFlagType.CLOSING_BLOCK:
					flags.closingBlock = true;
					break;
				case MacroFlagType.PRESERVE_WHITESPACE:
					flags.preserveWhitespace = true;
					break;
				default: console.warn(`Can't parse unknown macro flag: ${symbol}`);
			}
			flags.raw.push(symbol);
		}
		return flags;
	}
	// cache/upstream/sillytavern/public/scripts/macros/engine/MacroRegistry.js
	/** @typedef {import('chevrotain').CstNode} CstNode */
	/** @typedef {import('./MacroEnv.types.js').MacroEnv} MacroEnv */
	/** @typedef {import('./MacroCstWalker.js').MacroCall} MacroCall */
	/** @typedef {import('./MacroFlags.js').MacroFlags} MacroFlags */
	/**
	* Enum of standard macro categories for grouping in documentation and autocomplete.
	* Extensions may use these or define custom category strings.
	*
	* @readonly
	* @enum {string}
	*/
	var MacroCategory = Object.freeze({
		/** Basic utilities and text manipulation (newline, noop, trim, reverse, comment) */
		UTILITY: "utility",
		/** Randomization and dice rolling (random, pick, roll) */
		RANDOM: "random",
		/** Participant names and name lists (user, char, group, notChar) */
		NAMES: "names",
		/** Character card fields and persona (description, personality, scenario, mesExamples, persona) */
		CHARACTER: "character",
		/** Chat history, messages, and swipes */
		CHAT: "chat",
		/** Date, time, and duration macros */
		TIME: "time",
		/** Local and global variable operations */
		VARIABLE: "variable",
		/** Prompt templates for text completion (instruct sequences, system prompts, author's notes, context templates) */
		PROMPTS: "prompts",
		/** Runtime application state (model, API, lastGenerationType, isMobile) */
		STATE: "state",
		/** Macros that don't fit in any of the other categories, but don't really need/deserve their own */
		MISC: "misc",
		/** Macros that are registered but not assigned to a category (any macro should have a category, so let the extension author know...) */
		UNCATEGORIZED: "uncategorized"
	});
	/**
	* Enum of standard macro value types for type checking and documentation.
	* Used for both argument types and return types.
	*
	* @readonly
	* @enum {string}
	*/
	var MacroValueType = Object.freeze({
		/** String value of any kind */
		STRING: "string",
		/** Integer value (natural number, no decimal spaces) */
		INTEGER: "integer",
		/** Number value (decimal spaces allowed, includes integers values) */
		NUMBER: "number",
		/** Boolean value (true/false, 1/0, yes/no, on/off) */
		BOOLEAN: "boolean"
	});
	/**
	* @typedef {Object} MacroDefinitionOptions
	* @property {MacroAliasDef[]} [aliases] - Alternative names for this macro. Each alias creates a lookup entry pointing to the same definition.
	* @property {MacroCategory|string} [category=MacroCategory.UNCATEGORIZED] - Category for grouping in documentation/autocomplete. Use MacroCategory enum values or a custom string.
	* @property {number|MacroUnnamedArgDef[]} [unnamedArgs=0] - Specifies the macro's unnamed positional arguments. Can be a number (all required) or an array of definitions (supports optional args). Optional args must be a suffix.
	* @property {boolean|MacroListSpec} [list] - Whether the macro allows a list of arguments (optional min and max values can be set). These arguments will be added AFTER the unnamed args.
	* @property {boolean} [strictArgs=true] - Whether the macro should be strict about its arguments.
	* @property {string} [description=''] - Add a description of what the macro does.
	* @property {string} [returns] - Add a specific description of what the macro returns, if it is not obvious from the description.
	* @property {MacroValueType|MacroValueType[]} [returnType=MacroValueType.STRING] - The type(s) this macro returns. Defaults to string.
	* @property {string} [displayOverride] - Override the auto-generated macro signature for display (must include curly braces, e.g. "{{macro::arg}}").
	* @property {string|string[]} [exampleUsage] - Example usage(s) shown in documentation (must include curly braces).
	* @property {boolean} [delayArgResolution=false] - If true, nested macros in arguments or scope are NOT resolved before calling the handler. The handler receives raw argument text and must call resolve() manually. Use sparingly - only for control-flow macros like {{if}}.
	* @property {MacroHandler} handler - The handler function for the macro.
	*/
	/**
	* @typedef {Object} MacroAliasDef
	* @property {string} alias - The alias name.
	* @property {boolean} [visible=true] - Whether this alias appears in documentation/autocomplete. Defaults to true.
	*/
	/**
	* @typedef {Object} MacroUnnamedArgDef
	* @property {string} name
	* @property {boolean} [optional=false] - Whether this argument is optional. Optional args must form a contiguous suffix (no required args after an optional).
	* @property {string} [defaultValue] - Default value for optional args. ONLY meaningful when optional is true. Shown in docs/autocomplete.
	* @property {MacroValueType|MacroValueType[]} [type=MacroValueType.STRING] - Single type or array of accepted types.
	* @property {string} [sampleValue]
	* @property {string} [description]
	*/
	/**
	* @typedef {Object} MacroListSpec
	* @property {number} [min]
	* @property {number} [max]
	*/
	/**
	* @typedef {(context: MacroExecutionContext) => string} MacroHandler
	*/
	/**
	* @typedef {Object} MacroExecutionContext
	* @property {string} name
	* @property {string[]} args - All unnamed arguments passed to the macro. If delayArgResolution is true, these contain raw (unresolved) text.
	* @property {string[]} unnamedArgs - Unnamed positional arguments (both required and optional, up to the defined count).
	* @property {string[]|null} list - List arguments (after unnamed args), or null if list is not enabled.
	* @property {{ [key: string]: string }|null} namedArgs - Reserved for future named argument support.
	* @property {MacroFlags} flags - Macro execution flags that were applied to this macro invocation.
	* @property {boolean} isScoped - Whether this macro was invoked using scoped syntax (opening + closing tags).
	* @property {string} raw - The inner macro content with nested macros resolved.
	* @property {string} rawOriginal - The original full macro text including braces, before any resolution.
	* @property {string[]} rawArgs - The original arguments passed to the macro (always unresolved).
	* @property {MacroEnv} env
	* @property {CstNode} cstNode
	* @property {{ startOffset: number, endOffset: number }} range - Range relative to the current evaluation context's text.
	* @property {number} globalOffset - The offset of this macro in the original top-level document.
	*           This combines the context's base offset with the local range. Use this for deterministic
	*           seeding (e.g., in {{pick}}) to ensure identical macros at different positions produce different results.
	* @property {(value: any) => string} normalize - Normalize function to use on unsure macro results to make sure they return strings as expected.
	* @property {(content: string, options?: { trimIndent?: boolean }) => string} trimContent - Trims scoped content with optional indentation dedent. Defaults to trimming indentation.
	* @property {(text: string, options?: { offsetDelta?: number }) => string} resolve - Evaluates macros in the given text using the same environment.
	*           Use when delayArgResolution is true. By default, preserves the caller's globalOffset so nested
	*           macros like {{pick}} maintain deterministic position-based behavior. Pass offsetDelta to add
	*           an additional offset for uniqueness (e.g., to differentiate between multiple resolve calls).
	* @property {(message: string, error?: any) => void} warn - Logs a runtime warning with automatic macro call context.
	*           Use this to report issues in how the macro was invoked (e.g., invalid argument values, edge cases).
	*/
	/**
	* @typedef {Object} MacroDefinition
	* @property {string} name - Primary macro name.
	* @property {MacroResolvedAlias[]} aliases - Parsed alias definitions for this macro.
	* @property {MacroCategory|string} category
	* @property {number} minArgs - Minimum number of unnamed args required (excludes optional args).
	* @property {number} maxArgs - Maximum number of unnamed args accepted (includes optional args).
	* @property {MacroUnnamedArgDef[]} unnamedArgDefs - Definitions for all unnamed positional arguments (required + optional).
	* @property {{ min: number, max: (number|null) }|null} list
	* @property {boolean} strictArgs
	* @property {string} description
	* @property {string|null} returns
	* @property {MacroValueType|MacroValueType[]} returnType - The type(s) this macro returns.
	* @property {string|null} displayOverride - Override for the auto-generated macro signature display.
	* @property {string[]} exampleUsage - Example usage strings for documentation.
	* @property {boolean} delayArgResolution - If true, nested macros in arguments are NOT resolved before calling the handler. The handler receives raw argument text and must call resolve() manually. Use sparingly - only for control-flow macros like {{if}}.
	* @property {MacroHandler} handler
	* @property {MacroSource} source
	* @property {string|null} aliasOf - If this is an alias, the primary macro name this is an alias of. Can also be used to check if this is an alias macro.
	* @property {boolean|null} aliasVisible - If this is an alias, whether this alias is visible in docs/autocomplete.
	*/
	/**
	* @typedef {Object} MacroResolvedAlias
	* @property {string} alias - The alias name.
	* @property {boolean} visible - Whether this alias is visible in documentation/autocomplete.
	*/
	/**
	* @typedef {Object} MacroSource
	* @property {string} name - Source identifier (extension name or script path)
	* @property {boolean} isExtension - True if registered from an extension
	* @property {boolean} isThirdParty - True if registered from a third-party extension
	*/
	/**
	* The singleton instance of the MacroRegistry.
	*
	* @type {MacroRegistry}
	*/
	var instance$2 = class MacroRegistry {
		/** @type {MacroRegistry} */ static #instance;
		/** @type {MacroRegistry} */ static get instance() {
			return MacroRegistry.#instance ?? (MacroRegistry.#instance = new MacroRegistry());
		}
		/** @type {Map<string, MacroDefinition>} */
		#macros;
		/**
		* @private
		*/
		constructor() {
			/** @type {Map<string, MacroDefinition>} */
			this.#macros = /* @__PURE__ */ new Map();
		}
		/**
		* Registers a macro with the registry.
		* Errors during registration are caught and logged, the macro will not be registered, and the function returns null.
		*
		* @param {string} name - Macro name (identifier).
		* @param {MacroDefinitionOptions} options - Macro registration options including handler and metadata.
		* @returns {MacroDefinition|null} The registered definition, or null if registration failed.
		*/
		registerMacro(name, options) {
			name = typeof name === "string" ? name.trim() : String(name);
			try {
				const { isExtension, isThirdParty, source } = detectMacroSource();
				const definition = this.buildMacroDefFromOptions(name, options, { source: {
					name: source,
					isExtension,
					isThirdParty
				} });
				this.#registerMacroEntry(name, definition);
				for (const { alias, visible } of definition.aliases) this.#registerMacroEntry(alias, definition, {
					primaryMacroName: name,
					aliasVisible: visible
				});
				return definition;
			} catch (error) {
				logMacroRegisterError({
					message: `Failed to register macro "${name}". The macro will not be available.`,
					macroName: name,
					error
				});
				return null;
			}
		}
		/**
		* Registers an alias for an existing macro.
		* The alias will point to the same handler and metadata as the original macro.
		* Errors during registration are caught and logged, the alias will not be registered, and the function returns false.
		*
		* @param {string} targetMacroName - The name of the existing macro to create an alias for.
		* @param {string} aliasName - The alias name (identifier).
		* @param {Object} [options] - Alias registration options.
		* @param {boolean} [options.visible=true] - Whether this alias appears in documentation/autocomplete.
		* @returns {boolean} True if the alias was registered successfully, false if registration failed.
		*/
		registerMacroAlias(targetMacroName, aliasName, { visible = true } = {}) {
			targetMacroName = typeof targetMacroName === "string" ? targetMacroName.trim() : String(targetMacroName);
			aliasName = typeof aliasName === "string" ? aliasName.trim() : String(aliasName);
			try {
				if (!isIdentifierValid(aliasName)) throw new Error(`Alias name "${aliasName}" is invalid. Must start with a letter, followed by alphanumeric characters or hyphens.`);
				if (aliasName.toLowerCase() === targetMacroName.toLowerCase()) throw new Error(`Alias name "${aliasName}" cannot be the same as the target macro name (case insensitive).`);
				const targetDefinition = this.getMacro(targetMacroName);
				if (!targetDefinition) throw new Error(`Target macro "${targetMacroName}" is not registered.`);
				const primaryDefinition = targetDefinition.aliasOf ? this.getMacro(targetDefinition.aliasOf) : targetDefinition;
				if (!primaryDefinition) throw new Error(`Could not resolve primary definition for target macro "${targetMacroName}".`);
				const { isExtension, isThirdParty, source } = detectMacroSource();
				const aliasDefinition = {
					...primaryDefinition,
					source: {
						name: source,
						isExtension,
						isThirdParty
					}
				};
				this.#registerMacroEntry(aliasName, aliasDefinition, {
					primaryMacroName: primaryDefinition.name,
					aliasVisible: visible
				});
				return true;
			} catch (error) {
				logMacroRegisterError({
					message: `Failed to register alias "${aliasName}" for macro "${targetMacroName}". The alias will not be available.`,
					macroName: aliasName,
					error
				});
				return false;
			}
		}
		/**
		* Shared utility for registering macro entries (primary or alias).
		*
		* @param {string} name - The registration name (primary macro or alias).
		* @param {MacroDefinition} definition - The definition to register.
		* @param {Object} [options={}] - Options for alias registration.
		* @param {string} [options.primaryMacroName=null] - For aliases, the primary macro name.
		* @param {boolean} [options.aliasVisible=null] - For aliases, visibility flag.
		*/
		#registerMacroEntry(name, definition, { primaryMacroName = null, aliasVisible = null } = {}) {
			const nameKey = name.toLowerCase();
			if (this.#macros.has(nameKey)) {
				const warningType = primaryMacroName ? `Alias "${name}" for macro "${primaryMacroName}"` : `Macro "${name}"`;
				logMacroRegisterWarning({
					macroName: primaryMacroName || name,
					message: `${warningType} ${primaryMacroName ? "overwrites an existing macro." : "is already registered and will be overwritten."}`
				});
			}
			/** @type {MacroDefinition} */
			const entry = primaryMacroName ? {
				...definition,
				name,
				aliasOf: primaryMacroName,
				aliasVisible
			} : definition;
			this.#macros.set(nameKey, entry);
		}
		/**
		* Unregisters a macro.
		*
		* @param {string} name - Macro name (identifier).
		* @returns {boolean} True if a macro was removed.
		*/
		unregisterMacro(name) {
			if (typeof name !== "string" || !name.trim()) throw new Error("Macro name must be a non-empty string");
			name = name.trim();
			return this.#macros.delete(name.toLowerCase());
		}
		/**
		* Checks whether a macro with the given name is registered.
		*
		* @param {string} name - Macro name (identifier).
		* @returns {boolean}
		*/
		hasMacro(name) {
			if (typeof name !== "string" || !name.trim()) return false;
			name = name.trim();
			return this.#macros.has(name.toLowerCase());
		}
		/**
		* Returns the macro definition for a given name.
		*
		* @param {string} name - Macro name (identifier).
		* @returns {MacroDefinition|undefined}
		*/
		getMacro(name) {
			if (typeof name !== "string" || !name.trim()) return void 0;
			name = name.trim();
			return this.#macros.get(name.toLowerCase());
		}
		/**
		* Returns the primary (non-alias) definition for a macro.
		* If given an alias name, returns the primary definition it points to.
		*
		* @param {string} name - Macro name or alias.
		* @returns {MacroDefinition|undefined}
		*/
		getPrimaryMacro(name) {
			const def = this.getMacro(name);
			if (!def) return void 0;
			return def.aliasOf ? this.getMacro(def.aliasOf) : def;
		}
		/**
		* Returns an array of all registered macros.
		*
		* @param {Object} [options] - Filter options.
		* @param {boolean} [options.excludeAliases=false] - If true, excludes alias entries (only returns primary definitions).
		* @param {boolean} [options.excludeHiddenAliases=false] - If true, excludes alias entries where visible=false.
		* @returns {MacroDefinition[]}
		*/
		getAllMacros({ excludeAliases = false, excludeHiddenAliases = false } = {}) {
			let macros = Array.from(this.#macros.values());
			if (excludeAliases) macros = macros.filter((m) => !m.aliasOf);
			else if (excludeHiddenAliases) macros = macros.filter((m) => !m.aliasOf || m.aliasVisible !== false);
			return macros;
		}
		/**
		* Executes a macro for a given call.
		*
		* @param {MacroCall} call - Macro call information.
		* @param {Object} [options] - Additional options.
		* @param {MacroDefinition} [options.defOverride] - Override the macro definition.
		* @returns {string}
		*/
		executeMacro(call, { defOverride } = {}) {
			const name = call.name;
			const def = defOverride || this.getMacro(name);
			if (!def) throw new Error(`Macro "${name}" is not registered`);
			const args = Array.isArray(call.args) ? call.args : [];
			if (!isArgsValid(def, args)) {
				const expectedMin = def.list ? def.minArgs + def.list.min : def.minArgs;
				const expectedMax = def.list && def.list.max !== null ? def.maxArgs + def.list.max : def.list ? null : def.maxArgs;
				const expectation = (() => {
					if (expectedMax !== null && expectedMax !== expectedMin) return `between ${expectedMin} and ${expectedMax}`;
					if (expectedMax !== null && expectedMax === expectedMin) return `${expectedMin}`;
					return `at least ${expectedMin}`;
				})();
				const message = `Macro "${def.name}" called with ${args.length} unnamed arguments but expects ${expectation}.`;
				if (def.strictArgs) throw createMacroRuntimeError({
					message,
					call,
					def
				});
				logMacroRuntimeWarning({
					message,
					call,
					def
				});
			}
			const unnamedArgsCount = Math.min(args.length, def.maxArgs);
			const unnamedArgsValues = args.slice(0, unnamedArgsCount);
			const listValues = !def.list ? null : args.length > def.maxArgs ? args.slice(def.maxArgs) : [];
			validateArgTypes(call, def, unnamedArgsValues);
			/** @type {MacroExecutionContext} */
			const executionContext = {
				name: def.name,
				args,
				unnamedArgs: unnamedArgsValues,
				list: listValues,
				namedArgs: null,
				flags: call.flags,
				isScoped: call.isScoped,
				raw: call.rawInner,
				rawOriginal: call.rawWithBraces,
				rawArgs: call.rawArgs,
				env: call.env,
				cstNode: call.cstNode,
				range: call.range,
				globalOffset: call.globalOffset,
				normalize: instance.normalizeMacroResult.bind(instance),
				trimContent: instance.trimScopedContent.bind(instance),
				resolve: (text, { offsetDelta = 0 } = {}) => instance.evaluate(text, call.env, { contextOffset: call.globalOffset + offsetDelta }),
				warn: (message, error = void 0) => logMacroRuntimeWarning({
					message,
					call,
					def,
					error
				})
			};
			const result = def.handler(executionContext);
			return executionContext.normalize(result);
		}
		/**
		* Builds a MacroDefinition from MacroDefinitionOptions.
		*
		* This is the core logic building the actual registered macro from an options object
		* that has nearly everything as optional args.
		*
		* The options object is highly flexible and allows defining all aspects of a macro
		* through optional properties. This method processes and validates the options to
		* create a proper MacroDefinition that can be registered with the engine.
		*
		* Validation includes checking for required fields, validating argument definitions,
		* and ensuring the handler function is callable.
		* It throws errors for invalid configurations.
		*
		* @param {string} name - Macro name (identifier).
		* @param {MacroDefinitionOptions} options - Macro definition options.
		* @param {Object} [buildOptions] - Additional options for building.
		* @param {MacroSource} [buildOptions.source] - Source information. Defaults to dynamic source.
		* @returns {MacroDefinition} The built macro definition.
		* @throws {Error} If validation fails.
		*/
		buildMacroDefFromOptions(name, options, { source } = {}) {
			name = typeof name === "string" ? name.trim() : String(name);
			if (!isIdentifierValid(name)) throw new Error(`Macro name "${name}" is invalid. Must start with a letter, followed by alphanumeric characters or hyphens.`);
			if (!options || typeof options !== "object") throw new Error(`Macro "${name}" options must be a non-null object.`);
			const { aliases: rawAliases, category: rawCategory, unnamedArgs: rawUnnamedArgs, list: rawList, strictArgs: rawStrictArgs, description: rawDescription, returns: rawReturns, returnType: rawReturnType, displayOverride: rawDisplayOverride, exampleUsage: rawExampleUsage, delayArgResolution: rawDelayArgResolution, handler } = options;
			if (typeof handler !== "function") throw new Error(`Macro "${name}" options.handler must be a function.`);
			/** @type {MacroResolvedAlias[]} */
			const aliases = [];
			if (rawAliases !== void 0 && rawAliases !== null) {
				if (!Array.isArray(rawAliases)) throw new Error(`Macro "${name}" options.aliases must be an array.`);
				for (const [i, aliasDef] of rawAliases.entries()) {
					if (!aliasDef || typeof aliasDef !== "object") throw new Error(`Macro "${name}" options.aliases[${i}] must be an object.`);
					if (typeof aliasDef.alias !== "string" || !aliasDef.alias.trim()) throw new Error(`Macro "${name}" options.aliases[${i}].alias must be a non-empty string.`);
					const aliasName = aliasDef.alias.trim();
					if (!isIdentifierValid(aliasName)) throw new Error(`Macro "${name}" options.aliases[${i}].alias "${aliasName}" is invalid. Must start with a letter, followed by word chars or hyphens.`);
					if (aliasName.toLowerCase() === name.toLowerCase()) throw new Error(`Macro "${name}" options.aliases[${i}].alias cannot be the same as the macro name (insensitive).`);
					const visible = aliasDef.visible !== false;
					aliases.push({
						alias: aliasName,
						visible
					});
				}
			}
			/** @type {MacroCategory|string} */
			let category = MacroCategory.UNCATEGORIZED;
			if (typeof rawCategory === "string" && rawCategory.trim()) category = rawCategory.trim();
			let minArgs = 0;
			let maxArgs = 0;
			/** @type {MacroUnnamedArgDef[]} */
			let unnamedArgDefs = [];
			if (rawUnnamedArgs !== void 0) {
				if (Array.isArray(rawUnnamedArgs)) {
					let foundOptional = false;
					unnamedArgDefs = rawUnnamedArgs.map((def, index) => {
						if (!def || typeof def !== "object") throw new Error(`Macro "${name}" options.unnamedArgs[${index}] must be an object when using argument definitions.`);
						if (typeof def.name !== "string" || !def.name.trim()) throw new Error(`Macro "${name}" options.unnamedArgs[${index}].name must be a non-empty string when using argument definitions.`);
						if (foundOptional && !def.optional) throw new Error(`Macro "${name}" options.unnamedArgs[${index}] is required but follows an optional argument. Optional args must be a suffix.`);
						if (def.optional) foundOptional = true;
						/** @type {MacroUnnamedArgDef} */
						const normalized = {
							name: def.name.trim(),
							optional: def.optional || false,
							defaultValue: def.defaultValue?.trim(),
							type: Array.isArray(def.type) && def.type.length === 0 ? "string" : def.type ?? "string",
							sampleValue: def.sampleValue?.trim(),
							description: typeof def.description === "string" ? def.description : void 0
						};
						const validTypes = [
							"string",
							"integer",
							"number",
							"boolean"
						];
						if ((Array.isArray(normalized.type) ? normalized.type : [normalized.type]).some((t) => !validTypes.includes(t))) throw new Error(`Macro "${name}" options.unnamedArgs[${index}].type must be one of "string", "integer", "number", or "boolean" when provided.`);
						return normalized;
					});
					maxArgs = unnamedArgDefs.length;
					minArgs = unnamedArgDefs.findIndex((d) => d.optional);
					if (minArgs === -1) minArgs = maxArgs;
				} else if (typeof rawUnnamedArgs === "number") {
					if (!Number.isInteger(rawUnnamedArgs) || rawUnnamedArgs < 0) throw new Error(`Macro "${name}" options.unnamedArgs must be a non-negative integer when provided.`);
					minArgs = rawUnnamedArgs;
					maxArgs = rawUnnamedArgs;
					unnamedArgDefs = Array.from({ length: rawUnnamedArgs }, (_, i) => ({
						name: `arg${i + 1}`,
						optional: false,
						type: "string",
						sampleValue: `arg${i + 1}`
					}));
				} else throw new Error(`Macro "${name}" options.unnamedArgs must be a non-negative integer or an array of argument definitions when provided.`);
			}
			/** @type {{ min: number, max: (number|null) }|null} */
			let list = null;
			if (rawList !== void 0) {
				if (typeof rawList === "boolean") list = rawList ? {
					min: 0,
					max: null
				} : null;
				else if (typeof rawList === "object" && rawList !== null) {
					if (typeof rawList.min !== "number" || rawList.min < 0) throw new Error(`Macro "${name}" options.list.min must be a non-negative integer when provided.`);
					if (rawList.max !== void 0 && typeof rawList.max !== "number") throw new Error(`Macro "${name}" options.list.max must be a number when provided.`);
					if (rawList.max !== void 0 && rawList.max < rawList.min) throw new Error(`Macro "${name}" options.list.max must be greater than or equal to options.list.min.`);
					list = {
						min: rawList.min,
						max: rawList.max ?? null
					};
				} else throw new Error(`Macro "${name}" options.list must be a boolean or an object with numeric min/max when provided.`);
			}
			let strictArgs = true;
			if (rawStrictArgs !== void 0) {
				if (typeof rawStrictArgs !== "boolean") throw new Error(`Macro "${name}" options.strictArgs must be a boolean when provided.`);
				strictArgs = rawStrictArgs;
			}
			let description = "<no description>";
			if (rawDescription !== void 0) {
				if (typeof rawDescription !== "string") throw new Error(`Macro "${name}" options.description must be a string when provided.`);
				description = rawDescription;
			}
			let returns = null;
			if (rawReturns !== void 0 && rawReturns !== null) {
				if (typeof rawReturns !== "string") throw new Error(`Macro "${name}" options.returns must be a string when provided.`);
				returns = rawReturns || "<empty string>";
			}
			const validTypes = [
				"string",
				"integer",
				"number",
				"boolean"
			];
			let returnType = "string";
			if (rawReturnType !== void 0 && rawReturnType !== null) {
				returnType = Array.isArray(rawReturnType) && rawReturnType.length === 0 ? "string" : rawReturnType;
				if ((Array.isArray(returnType) ? returnType : [returnType]).some((t) => !validTypes.includes(t))) throw new Error(`Macro "${name}" options.returnType must be one of "string", "integer", "number", or "boolean" (or an array of these) when provided.`);
			}
			let displayOverride = null;
			if (rawDisplayOverride !== void 0 && rawDisplayOverride !== null) {
				if (typeof rawDisplayOverride !== "string") throw new Error(`Macro "${name}" options.displayOverride must be a string when provided.`);
				displayOverride = rawDisplayOverride.trim();
				if (displayOverride && !displayOverride.startsWith("{{")) {
					logMacroRegisterWarning({
						macroName: name,
						message: `Macro "${name}" options.displayOverride should include curly braces. Auto-wrapping.`
					});
					displayOverride = `{{${displayOverride}}}`;
				}
			}
			/** @type {string[]} */
			let exampleUsage = [];
			if (rawExampleUsage !== void 0 && rawExampleUsage !== null) {
				const examples = Array.isArray(rawExampleUsage) ? rawExampleUsage : [rawExampleUsage];
				for (const [i, ex] of examples.entries()) {
					if (typeof ex !== "string") throw new Error(`Macro "${name}" options.exampleUsage[${i}] must be a string.`);
					let trimmed = ex.trim();
					if (trimmed && !trimmed.startsWith("{{")) {
						logMacroRegisterWarning({
							macroName: name,
							message: `Macro "${name}" options.exampleUsage[${i}] should include curly braces. Auto-wrapping.`
						});
						trimmed = `{{${trimmed}}}`;
					}
					if (trimmed) exampleUsage.push(trimmed);
				}
			}
			let delayArgResolution = false;
			if (rawDelayArgResolution !== void 0) {
				if (typeof rawDelayArgResolution !== "boolean") throw new Error(`Macro "${name}" options.delayArgResolution must be a boolean when provided.`);
				delayArgResolution = rawDelayArgResolution;
			}
			return {
				name,
				aliases,
				category,
				minArgs,
				maxArgs,
				unnamedArgDefs,
				list,
				strictArgs,
				description,
				returns,
				returnType,
				displayOverride,
				exampleUsage,
				delayArgResolution,
				handler,
				source: source ?? {
					name: "dynamic",
					isExtension: false,
					isThirdParty: false
				},
				aliasOf: null,
				aliasVisible: null
			};
		}
	}.instance;
	/**
	* Validates a macro identifier.
	*
	* @param {string} name - The macro identifier to validate.
	* @param {Object} [options] - Validation options.
	* @param {boolean} [options.allowComment = true] - Whether return that the comment identifier '//' is valid.
	* @returns {boolean} True if the identifier is valid, false otherwise.
	*/
	function isIdentifierValid(name, { allowComment = true } = {}) {
		if (typeof name !== "string" || !name.trim()) return false;
		if (allowComment && name === "//") return true;
		return MACRO_IDENTIFIER_PATTERN.test(name);
	}
	/**
	* Validates the arguments for a macro definition.
	* Supports required args (minArgs), optional args (up to maxArgs), and list tail.
	*
	* @param {MacroDefinition} def - Macro definition.
	* @param {any[]} args - Arguments to validate.
	* @returns {boolean} True if the arguments are valid, false otherwise.
	*/
	function isArgsValid(def, args) {
		if (!(def.list !== null)) return args.length >= def.minArgs && args.length <= def.maxArgs;
		const minRequired = def.minArgs + def.list.min;
		if (args.length < minRequired) return false;
		const listCount = Math.max(0, args.length - def.maxArgs);
		if (def.list.max !== null && listCount > def.list.max) return false;
		return true;
	}
	/**
	* Performs type validation for unnamed positional arguments using the metadata
	* defined on the macro definition. When strictArgs is true, invalid argument
	* types cause an error to be thrown. When strictArgs is false, only warnings
	* are logged and execution continues.
	*
	* @param {MacroCall} call
	* @param {MacroDefinition} def
	* @param {string[]} unnamedArgs
	*/
	function validateArgTypes(call, def, unnamedArgs) {
		if (def.unnamedArgDefs.length === 0) return;
		const defs = def.unnamedArgDefs;
		const count = Math.min(defs.length, unnamedArgs.length);
		for (let i = 0; i < count; i++) {
			const argDef = defs[i];
			const value = unnamedArgs[i];
			if (!argDef || !argDef.type || typeof value !== "string") throw new Error(`Macro "${call.name}" (position ${i + 1}) has invalid definition or type.`);
			if (!(Array.isArray(argDef.type) ? argDef.type : [argDef.type]).some((type) => isValueOfType(value, type))) {
				const argName = argDef.name || `Argument ${i + 1}`;
				const optionalLabel = argDef.optional ? " (optional)" : "";
				const message = `Macro "${call.name}" (position ${i + 1}${optionalLabel}) argument "${argName}" expected type ${argDef.type} but got value "${value}".`;
				if (def.strictArgs) throw createMacroRuntimeError({
					message,
					call,
					def
				});
				logMacroRuntimeWarning({
					message,
					call,
					def
				});
			}
		}
	}
	/**
	* Checks whether a string value conforms to the given macro argument type.
	*
	* @param {string} value
	* @param {MacroValueType} type
	* @returns {boolean}
	*/
	function isValueOfType(value, type) {
		const trimmed = value.trim();
		if (type === "string") return true;
		if (type === "integer") return /^-?\d+$/.test(trimmed);
		if (type === "number") {
			const n = Number(trimmed);
			return Number.isFinite(n);
		}
		if (type === "boolean") return isTrueBoolean(trimmed) || isFalseBoolean(trimmed);
		return false;
	}
	/**
	* Detects the source of a macro registration from the call stack.
	* Similar to how SlashCommandParser detects command sources.
	*
	* @returns {{ isExtension: boolean, isThirdParty: boolean, source: string }}
	*/
	function detectMacroSource() {
		const stack = (/* @__PURE__ */ new Error()).stack?.split("\n").map((line) => line.trim()) ?? [];
		const isExtension = stack.some((line) => line.includes("/scripts/extensions/"));
		const isThirdParty = stack.some((line) => line.includes("/scripts/extensions/third-party/"));
		let source = "unknown";
		if (isThirdParty) {
			const match = stack.find((line) => line.includes("/scripts/extensions/third-party/"));
			if (match) source = match.replace(/^.*?\/scripts\/extensions\/third-party\/([^/]+)\/.*$/, "$1");
		} else if (isExtension) {
			const match = stack.find((line) => line.includes("/scripts/extensions/"));
			if (match) source = match.replace(/^.*?\/scripts\/extensions\/([^/]+)\/.*$/, "$1");
		} else {
			const callerIdx = stack.findIndex((line) => line.includes("registerMacro") && line.includes("MacroRegistry"));
			if (callerIdx >= 0 && callerIdx + 1 < stack.length) {
				const scriptMatch = stack[callerIdx + 1].match(/\/((?:scripts\/)?(?:macros\/)?[^/]+\.js)/);
				if (scriptMatch) source = scriptMatch[1];
			}
		}
		return {
			isExtension,
			isThirdParty,
			source
		};
	}
	// cache/upstream/sillytavern/public/scripts/macros/engine/MacroCstWalker.js
	/** @typedef {import('chevrotain').CstNode} CstNode */
	/** @typedef {import('chevrotain').IToken} IToken */
	/** @typedef {import('./MacroEnv.types.js').MacroEnv} MacroEnv */
	/** @typedef {import('./MacroFlags.js').MacroFlags} MacroFlags */
	/**
	* @typedef {Object} MacroCall
	* @property {string} name
	* @property {string[]} args
	* @property {MacroFlags} flags - Parsed macro execution flags.
	* @property {boolean} isScoped - Whether this macro was invoked using scoped syntax (opening + closing tags).
	* @property {boolean} [isVariableShorthand] - Whether this call originated from variable shorthand syntax.
	* @property {MacroEnv} env
	* @property {string} rawInner
	* @property {string} rawWithBraces
	* @property {string[]} rawArgs
	* @property {{ startOffset: number, endOffset: number }} range - Range relative to the current evaluation context's text.
	* @property {number} globalOffset - The offset of this macro in the original top-level document.
	*           This combines the context's base offset with the local range. Use this for deterministic
	*           seeding (e.g., in {{pick}}) to ensure identical macros at different positions produce different results.
	* @property {CstNode} cstNode
	*/
	/**
	* @typedef {Object} VariableExprInfo
	* @property {'local' | 'global'} scope - Whether this is a local (.) or global ($) variable.
	* @property {string} varName - The variable name.
	* @property {'get' | 'set' | 'inc' | 'dec' | 'add'} operation - The operation to perform.
	* @property {string | null} value - The value for set/add operations, null for get/inc/dec.
	*/
	/**
	* Context passed through the CST evaluation process.
	*
	* @typedef {Object} EvaluationContext
	* @property {string} text - The text being evaluated at the current level. This is NOT the same as env.content.
	*           At the top level, this is the full document text. When evaluating nested content (arguments or scoped
	*           content), this is the substring being evaluated. CST node positions are always relative to this text.
	*
	*           - Careful, this also means when resolving macros inside macro arguments, this will NOT be the text of
	*           the argument currently being resolved, but the full macro text with identifier and all macros.
	* @property {number} contextOffset - Base offset from the original top-level document. At the top level this is 0.
	*           When re-parsing nested content (arguments/scoped), this is set to the substring's start position in
	*           the original document. Used to calculate globalOffset for macros that need deterministic positioning.
	* @property {MacroEnv} env - The macro environment containing context like user/char names, variables, and the
	*           original full content (env.content). This remains constant throughout the evaluation.
	* @property {(call: MacroCall) => string} resolveMacro - Callback to resolve a macro call to its result string.
	* @property {(content: string, options?: { trimIndent?: boolean }) => string} trimContent - Shared utility function that trims scoped content with optional indentation dedent.
	*/
	/**
	* @typedef {Object} TokenRange
	* @property {number} startOffset
	* @property {number} endOffset
	*/
	/**
	* @typedef {Object} MacroNodeInfo
	* @property {string} name - The macro identifier name.
	* @property {boolean} isClosing - Whether this macro has the closing block flag (/).
	* @property {number} startOffset - Start position in the source text.
	* @property {number} endOffset - End position in the source text (inclusive).
	* @property {number} argCount - Number of arguments provided to the macro.
	*/
	/**
	* The singleton instance of the MacroCstWalker.
	*
	* @type {MacroCstWalker}
	*/
	var instance$1 = class MacroCstWalker {
		/** @type {MacroCstWalker} */ static #instance;
		/** @type {MacroCstWalker} */ static get instance() {
			return MacroCstWalker.#instance ?? (MacroCstWalker.#instance = new MacroCstWalker());
		}
		constructor() {}
		/**
		* Evaluates a full document CST into a resolved string.
		*
		* @param {EvaluationContext & { cst: CstNode }} options
		* @returns {string}
		*/
		evaluateDocument(options) {
			const { text, cst, contextOffset, env, resolveMacro, trimContent } = options;
			if (typeof text !== "string") throw new Error("MacroCstWalker.evaluateDocument: text must be a string");
			if (!cst || typeof cst !== "object" || !cst.children) throw new Error("MacroCstWalker.evaluateDocument: cst must be a CstNode");
			if (typeof resolveMacro !== "function") throw new Error("MacroCstWalker.evaluateDocument: resolveMacro must be a function");
			if (typeof trimContent !== "function") throw new Error("MacroCstWalker.evaluateDocument: trimContent must be a function");
			/** @type {EvaluationContext} */
			const context = {
				text,
				contextOffset,
				env,
				resolveMacro,
				trimContent
			};
			let items = this.#collectDocumentItems(cst);
			items = this.#processScopedMacros(items, text);
			if (items.length === 0) return text;
			let result = "";
			let cursor = 0;
			for (const item of items) {
				if (item.startOffset > cursor) result += text.slice(cursor, item.startOffset);
				if (item.type === "plaintext") {
					result += text.slice(item.startOffset, item.endOffset + 1);
					cursor = item.endOffset + 1;
				} else if (item.keepRaw) {
					result += text.slice(item.startOffset, item.endOffset + 1);
					cursor = item.endOffset + 1;
				} else {
					result += this.#evaluateMacroNode(item.node, context, item.scopedContent);
					if (item.scopedContent && item.scopedContent.closingEndOffset > item.endOffset) cursor = item.scopedContent.closingEndOffset + 1;
					else cursor = item.endOffset + 1;
				}
			}
			if (cursor < text.length) result += text.slice(cursor);
			return result;
		}
		/**
		* Extracts basic info from a macro CST node: name, closing flag, position, and argument count.
		* Returns null for variable expressions or nodes without valid identifiers.
		*
		* @param {CstNode} macroNode - A macro CST node from the parser.
		* @returns {MacroNodeInfo | null}
		*/
		extractMacroInfo(macroNode) {
			const children = macroNode?.children || {};
			if ((children.variableExpr || [])[0]) return null;
			const startToken = (children["Macro.Start"] || [])[0];
			const endToken = (children["Macro.End"] || [])[0];
			if (!startToken || !endToken) return null;
			const bodyChildren = (children.macroBody || [])[0]?.children || {};
			const name = (bodyChildren["Macro.identifier"] || [])[0]?.image || "";
			if (!name) return null;
			const argumentNodes = (bodyChildren.arguments || [])[0]?.children?.argument || [];
			const argCount = argumentNodes.length;
			let isClosing = (children.flags || []).some((token) => token.image === MacroFlagType.CLOSING_BLOCK);
			if (!isClosing && name === "//") {
				const firstArgNode = (argumentNodes || [])[0];
				if (firstArgNode) {
					if (this.#getFirstTokenInNode(firstArgNode)?.image?.startsWith("/")) isClosing = true;
				}
			}
			return {
				name,
				isClosing,
				startOffset: startToken.startOffset,
				endOffset: endToken.endOffset,
				argCount
			};
		}
		/**
		* Finds unclosed scoped macros in a document CST.
		* Used by autocomplete to suggest closing tags.
		*
		* @param {Object} options
		* @param {string} options.text - The document text.
		* @param {CstNode} options.cst - The parsed CST.
		* @returns {Array<{ name: string, startOffset: number, endOffset: number, paddingBefore: string, paddingAfter: string }>} - Array of unclosed macro info, innermost last.
		*/
		findUnclosedScopes(options) {
			const { text, cst } = options;
			if (typeof text !== "string" || !cst?.children) return [];
			let items = this.#collectDocumentItems(cst);
			/** @type {Array<{ name: string, startOffset: number, endOffset: number, paddingBefore: string, paddingAfter: string }>} */
			const unclosedStack = [];
			for (const item of items) {
				if (item.type !== "macro") continue;
				const info = this.extractMacroInfo(item.node);
				if (!info) continue;
				if (info.isClosing) {
					const matchIndex = unclosedStack.findLastIndex((s) => s.name.toLowerCase() === info.name.toLowerCase());
					if (matchIndex !== -1) unclosedStack.splice(matchIndex);
				} else if (this.#canAcceptScopedContent(item.node, info.name)) {
					const { paddingBefore, paddingAfter } = this.#extractMacroPadding(item.node, text);
					unclosedStack.push({
						name: info.name,
						startOffset: item.startOffset,
						endOffset: item.endOffset,
						paddingBefore,
						paddingAfter
					});
				}
			}
			return unclosedStack;
		}
		/**
		* Extracts the whitespace padding from a macro node.
		* Returns the whitespace after {{ and before }}.
		*
		* @param {CstNode} macroNode - The macro CST node.
		* @param {string} text - The source text.
		* @returns {{ paddingBefore: string, paddingAfter: string }}
		*/
		#extractMacroPadding(macroNode, text) {
			const children = macroNode.children || {};
			const startToken = (children["Macro.Start"] || [])[0];
			const endToken = (children["Macro.End"] || [])[0];
			if (!startToken || !endToken) return {
				paddingBefore: "",
				paddingAfter: ""
			};
			const innerStart = startToken.endOffset + 1;
			const innerEnd = endToken.startOffset;
			const innerText = text.slice(innerStart, innerEnd);
			const leadingMatch = innerText.match(/^(\s*)/);
			const paddingBefore = leadingMatch ? leadingMatch[1] : "";
			const trailingMatch = innerText.match(/(\s*)$/);
			return {
				paddingBefore,
				paddingAfter: trailingMatch ? trailingMatch[1] : ""
			};
		}
		/** @typedef {{ type: 'plaintext', startOffset: number, endOffset: number, token: IToken }} DocumentItemPlaintext */
		/** @typedef {{ type: 'macro', startOffset: number, endOffset: number, node: CstNode, scopedContent?: { startOffset: number, endOffset: number, closingEndOffset: number }, keepRaw?: boolean }} DocumentItemMacro */
		/** @typedef {DocumentItemPlaintext | DocumentItemMacro} DocumentItem */
		/**
		* Collects top-level plaintext tokens and macro nodes from the document CST.
		*
		* @param {CstNode} cst
		* @returns {Array<DocumentItem>}
		*/
		#collectDocumentItems(cst) {
			const plaintextTokens = cst.children.plaintext || [];
			const macroNodes = cst.children.macro || [];
			/** @type {Array<DocumentItem>} */
			const items = [];
			for (const token of plaintextTokens) {
				if (typeof token.startOffset !== "number" || typeof token.endOffset !== "number") continue;
				items.push({
					type: "plaintext",
					startOffset: token.startOffset,
					endOffset: token.endOffset,
					token
				});
			}
			for (const macroNode of macroNodes) {
				const endToken = ((macroNode.children || {})["Macro.End"] || [])[0];
				if (this.#isRecoveryToken(endToken)) {
					this.#flattenIncompleteMacro(macroNode, endToken, items);
					continue;
				}
				const range = this.#getMacroRange(macroNode);
				items.push({
					type: "macro",
					startOffset: range.startOffset,
					endOffset: range.endOffset,
					node: macroNode
				});
			}
			items.sort((a, b) => {
				if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
				return a.endOffset - b.endOffset;
			});
			return items;
		}
		/**
		* Evaluates a single macro CST node, resolving any nested macros first.
		*
		* @param {CstNode} macroNode
		* @param {EvaluationContext} context
		* @param {{ startOffset: number, endOffset: number, closingEndOffset: number }} [scopedContent] - Optional scoped content range for block macros.
		* @returns {string}
		*/
		#evaluateMacroNode(macroNode, context, scopedContent) {
			const { text, contextOffset, env, resolveMacro, trimContent } = context;
			const children = macroNode.children || {};
			const variableExprNode = (children.variableExpr || [])[0];
			if (variableExprNode) return this.#evaluateVariableExpr(macroNode, variableExprNode, context);
			const bodyChildren = (children.macroBody || [])[0]?.children || {};
			const name = (bodyChildren["Macro.identifier"] || [])[0]?.image || "";
			const flagSymbols = (children.flags || []).map((token) => token.image);
			const flags = flagSymbols.length > 0 ? parseFlags(flagSymbols) : createEmptyFlags();
			const range = this.#getMacroRange(macroNode);
			const startToken = (children["Macro.Start"] || [])[0];
			const endToken = (children["Macro.End"] || [])[0];
			const innerStart = startToken ? startToken.endOffset + 1 : range.startOffset;
			const innerEnd = endToken ? endToken.startOffset - 1 : range.endOffset;
			const argumentNodes = (bodyChildren.arguments || [])[0]?.children?.argument || [];
			const delayArgResolution = instance$2.getMacro(name)?.delayArgResolution === true;
			/** @type {string[]} */
			const args = [];
			/** @type {({ value: string } & TokenRange)[]} */
			const evaluatedArguments = [];
			/** @type {string[]} */
			const rawArgs = [];
			for (const argNode of argumentNodes) {
				const location = this.#getArgumentLocation(argNode);
				const rawArgText = location ? text.slice(location.startOffset, location.endOffset + 1) : "";
				rawArgs.push(rawArgText);
				const argValue = delayArgResolution ? rawArgText : this.#evaluateArgumentNode(argNode, context);
				args.push(argValue);
				if (location) evaluatedArguments.push({
					value: argValue,
					...location
				});
			}
			if (scopedContent) {
				if (scopedContent.startOffset > scopedContent.endOffset) {
					args.push("");
					rawArgs.push("");
				} else {
					const rawScopedText = text.slice(scopedContent.startOffset, scopedContent.endOffset + 1);
					rawArgs.push(rawScopedText);
					let scopedValue;
					if (delayArgResolution) scopedValue = rawScopedText;
					else {
						scopedValue = this.#evaluateScopedContent(scopedContent, context);
						if (!flags.preserveWhitespace) scopedValue = trimContent(scopedValue);
					}
					args.push(scopedValue);
					evaluatedArguments.push({
						value: scopedValue,
						startOffset: scopedContent.startOffset,
						endOffset: scopedContent.endOffset
					});
				}
			}
			evaluatedArguments.sort((a, b) => a.startOffset - b.startOffset);
			let rawInner = "";
			if (innerStart <= innerEnd) {
				let cursor = innerStart;
				for (const entry of evaluatedArguments) {
					if (entry.startOffset > cursor) rawInner += text.slice(cursor, entry.startOffset);
					rawInner += entry.value;
					cursor = entry.endOffset + 1;
				}
				if (cursor <= innerEnd) rawInner += text.slice(cursor, innerEnd + 1);
			}
			const value = resolveMacro({
				name,
				args,
				flags,
				isScoped: scopedContent != null,
				rawInner,
				rawWithBraces: text.slice(range.startOffset, range.endOffset + 1),
				rawArgs,
				range,
				globalOffset: contextOffset + range.startOffset,
				cstNode: macroNode,
				env
			});
			return typeof value === "string" ? value : String(value ?? "");
		}
		/**
		* Evaluates a variable expression node using direct variable API calls.
		* Supports operators: get, set (=), add (+=), sub (-=), inc (++), dec (--),
		* logical or (||), nullish coalescing (??), logical or assign (||=),
		* nullish coalescing assign (??=), and equality comparison (==).
		*
		* @param {CstNode} macroNode - The parent macro node.
		* @param {CstNode} variableExprNode - The variableExpr CST node.
		* @param {EvaluationContext} context - The evaluation context.
		* @returns {string}
		*/
		#evaluateVariableExpr(macroNode, variableExprNode, context) {
			const varChildren = variableExprNode.children || {};
			const isGlobal = !(varChildren["Var.scope"] || []).find((t) => t.tokenType?.name === "Var.LocalPrefix");
			const varName = (varChildren["Var.identifier"] || [])[0]?.image || "";
			const operatorNode = (varChildren.variableOperator || [])[0];
			const operatorChildren = operatorNode?.children || {};
			let operation = "get";
			let hasValueExpr = false;
			if (operatorNode) {
				const operatorToken = (operatorChildren["Var.operator"] || [])[0];
				if (operatorToken) switch (operatorToken.image) {
					case "++":
						operation = "inc";
						break;
					case "--":
						operation = "dec";
						break;
					case "=":
						operation = "set";
						hasValueExpr = true;
						break;
					case "+=":
						operation = "add";
						hasValueExpr = true;
						break;
					case "-=":
						operation = "sub";
						hasValueExpr = true;
						break;
					case "||":
						operation = "logicalOr";
						hasValueExpr = true;
						break;
					case "??":
						operation = "nullishCoalescing";
						hasValueExpr = true;
						break;
					case "||=":
						operation = "logicalOrAssign";
						hasValueExpr = true;
						break;
					case "??=":
						operation = "nullishCoalescingAssign";
						hasValueExpr = true;
						break;
					case "==":
						operation = "equals";
						hasValueExpr = true;
						break;
					case "!=":
						operation = "notEquals";
						hasValueExpr = true;
						break;
					case ">":
						operation = "greaterThan";
						hasValueExpr = true;
						break;
					case ">=":
						operation = "greaterThanOrEqual";
						hasValueExpr = true;
						break;
					case "<":
						operation = "lessThan";
						hasValueExpr = true;
						break;
					case "<=":
						operation = "lessThanOrEqual";
						hasValueExpr = true;
						break;
					default: logMacroInternalError({ message: `Lexer found macro operator that is not implemented for variable shorthand expressions in macro node '${macroNode.name}'.` });
				}
			}
			const lazyValue = hasValueExpr ? this.#createLazyValue(operatorChildren, context) : () => "";
			return this.#executeVariableOperation(varName, isGlobal, operation, lazyValue);
		}
		/**
		* Creates a lazy value resolver that caches its result on first call.
		* This ensures the value expression is only evaluated when actually needed.
		*
		* @param {Record<string, any>} operatorChildren - The children of the variableOperator node.
		* @param {EvaluationContext} context - The evaluation context.
		* @returns {() => string} A function that returns the evaluated value, caching the result.
		*/
		#createLazyValue(operatorChildren, context) {
			let cached = null;
			let resolved = false;
			return () => {
				if (!resolved) {
					cached = this.#evaluateVariableValue(operatorChildren, context);
					resolved = true;
				}
				return cached;
			};
		}
		/**
		* Executes a variable operation using the SillyTavern context API.
		*
		* @param {string} varName - The variable name.
		* @param {boolean} isGlobal - Whether this is a global ($) or local (.) variable.
		* @param {string} operation - The operation to perform.
		* @param {() => string} lazyValue - A lazy function that returns the value when called. Only evaluated when needed.
		* @returns {string} The result of the operation.
		*/
		#executeVariableOperation(varName, isGlobal, operation, lazyValue) {
			const ctx = SillyTavern.getContext();
			const vars = isGlobal ? ctx.variables.global : ctx.variables.local;
			/**
			* Normalizes macro results into a string.
			* @param {any} value
			* @returns {string}
			*/
			const normalize = instance.normalizeMacroResult.bind(instance);
			/**
			* Checks if a value is falsy (empty string, 0, '0', false, 'false', null, undefined).
			* @param {any} val
			* @returns {boolean}
			*/
			const isFalsy = (val) => !val || isFalseBoolean(normalize(val));
			switch (operation) {
				case "get": return normalize(vars.get(varName));
				case "set":
					vars.set(varName, lazyValue());
					return "";
				case "inc": return normalize(vars.inc(varName));
				case "dec": return normalize(vars.dec(varName));
				case "add":
					vars.add(varName, lazyValue());
					return "";
				case "sub": {
					const numValue = Number(lazyValue());
					if (!isNaN(numValue)) vars.add(varName, -numValue);
					else logMacroRuntimeWarning({ message: `Variable shorthand "-=" operator requires a numeric value, got: "${lazyValue()}"` });
					return "";
				}
				case "logicalOr": {
					const currentValue = vars.get(varName);
					return isFalsy(currentValue) ? normalize(lazyValue()) : normalize(currentValue);
				}
				case "nullishCoalescing": return vars.has(varName) ? normalize(vars.get(varName)) : normalize(lazyValue());
				case "logicalOrAssign": {
					const currentValue = vars.get(varName);
					if (isFalsy(currentValue)) {
						vars.set(varName, lazyValue());
						return normalize(lazyValue());
					}
					return normalize(currentValue);
				}
				case "nullishCoalescingAssign":
					if (!vars.has(varName)) {
						vars.set(varName, lazyValue());
						return normalize(lazyValue());
					}
					return normalize(vars.get(varName));
				case "equals": return normalize(vars.get(varName)) === normalize(lazyValue()) ? "true" : "false";
				case "notEquals": return normalize(vars.get(varName)) !== normalize(lazyValue()) ? "true" : "false";
				case "greaterThan": {
					const currentNum = Number(vars.get(varName));
					const compareNum = Number(lazyValue());
					if (isNaN(currentNum) || isNaN(compareNum)) {
						logMacroRuntimeWarning({ message: `Variable shorthand ">" operator requires numeric values. Got: "${vars.get(varName)}" > "${lazyValue()}"` });
						return "false";
					}
					return currentNum > compareNum ? "true" : "false";
				}
				case "greaterThanOrEqual": {
					const currentNum = Number(vars.get(varName));
					const compareNum = Number(lazyValue());
					if (isNaN(currentNum) || isNaN(compareNum)) {
						logMacroRuntimeWarning({ message: `Variable shorthand ">=" operator requires numeric values. Got: "${vars.get(varName)}" >= "${lazyValue()}"` });
						return "false";
					}
					return currentNum >= compareNum ? "true" : "false";
				}
				case "lessThan": {
					const currentNum = Number(vars.get(varName));
					const compareNum = Number(lazyValue());
					if (isNaN(currentNum) || isNaN(compareNum)) {
						logMacroRuntimeWarning({ message: `Variable shorthand "<" operator requires numeric values. Got: "${vars.get(varName)}" < "${lazyValue()}"` });
						return "false";
					}
					return currentNum < compareNum ? "true" : "false";
				}
				case "lessThanOrEqual": {
					const currentNum = Number(vars.get(varName));
					const compareNum = Number(lazyValue());
					if (isNaN(currentNum) || isNaN(compareNum)) {
						logMacroRuntimeWarning({ message: `Variable shorthand "<=" operator requires numeric values. Got: "${vars.get(varName)}" <= "${lazyValue()}"` });
						return "false";
					}
					return currentNum <= compareNum ? "true" : "false";
				}
				default:
					logMacroRuntimeWarning({ message: `Unknown variable shorthand operation: "${operation}"` });
					return "";
			}
		}
		/**
		* Evaluates the value part of a variable expression (after = or +=).
		* Resolves any nested macros in the value.
		*
		* @param {Record<string, any>} operatorChildren - The children of the variableOperator node.
		* @param {EvaluationContext} context - The evaluation context.
		* @returns {string}
		*/
		#evaluateVariableValue(operatorChildren, context) {
			const { text } = context;
			const valueNode = (operatorChildren["Var.value"] || [])[0];
			if (!valueNode) return "";
			const valueChildren = valueNode.children || {};
			const identifierTokens = valueChildren.Identifier || [];
			const unknownTokens = valueChildren.Unknown || [];
			const nestedMacros = valueChildren.macro || [];
			const allRanges = [...[...identifierTokens, ...unknownTokens].map((t) => ({
				startOffset: t.startOffset,
				endOffset: t.endOffset
			})), ...nestedMacros.map((m) => this.#getMacroRange(m))];
			if (allRanges.length === 0) return "";
			const startOffset = Math.min(...allRanges.map((r) => r.startOffset));
			const endOffset = Math.max(...allRanges.map((r) => r.endOffset));
			if (nestedMacros.length === 0) return text.slice(startOffset, endOffset + 1).trim();
			const nestedWithRange = nestedMacros.map((node) => ({
				node,
				range: this.#getMacroRange(node)
			}));
			nestedWithRange.sort((a, b) => a.range.startOffset - b.range.startOffset);
			let result = "";
			let cursor = startOffset;
			for (const entry of nestedWithRange) {
				if (entry.range.startOffset > cursor) result += text.slice(cursor, entry.range.startOffset);
				result += this.#evaluateMacroNode(entry.node, context);
				cursor = entry.range.endOffset + 1;
			}
			if (cursor <= endOffset) result += text.slice(cursor, endOffset + 1);
			return result.trim();
		}
		/**
		* Evaluates a single argument node by resolving nested macros and reconstructing
		* the original argument text.
		*
		* This method extracts the argument's raw text and re-parses it to properly
		* handle scoped macros (opening/closing tag pairs) that may appear within
		* the argument content.
		*
		* @param {CstNode} argNode - The argument CST node to evaluate.
		* @param {EvaluationContext} context - The evaluation context containing the parent document's text and environment.
		* @returns {string} The evaluated argument with all nested macros (including scoped ones) resolved.
		*/
		#evaluateArgumentNode(argNode, context) {
			const location = this.#getArgumentLocation(argNode);
			if (!location) return "";
			const { text, contextOffset } = context;
			const rawContent = text.slice(location.startOffset, location.endOffset + 1);
			const newContextOffset = contextOffset + location.startOffset;
			return this.#evaluateRawContent(rawContent, newContextOffset, context);
		}
		/**
		* Evaluates a text content string by parsing it and resolving all macros,
		* including scoped macro pairs (opening/closing tags).
		*
		* This is the core helper used by both argument evaluation and scoped content
		* evaluation to ensure consistent handling of nested and scoped macros.
		*
		* @param {string} rawContent - The raw text content to evaluate.
		* @param {number} newContextOffset - The offset of rawContent's start position in the original top-level document.
		* @param {EvaluationContext} context - The parent evaluation context (used for env, resolveMacro, trimContent).
		* @returns {string} The evaluated content with all macros resolved.
		*/
		#evaluateRawContent(rawContent, newContextOffset, context) {
			if (!rawContent) return "";
			const { cst } = instance$3.parseDocument(rawContent);
			if (!cst || typeof cst !== "object" || !cst.children) return rawContent;
			/** @type {EvaluationContext} */
			const contentContext = {
				...context,
				text: rawContent,
				contextOffset: newContextOffset
			};
			let items = this.#collectDocumentItems(cst);
			items = this.#processScopedMacros(items, rawContent);
			if (items.length === 0) return rawContent;
			let result = "";
			let cursor = 0;
			for (const item of items) {
				if (item.startOffset > cursor) result += rawContent.slice(cursor, item.startOffset);
				if (item.type === "plaintext") {
					result += rawContent.slice(item.startOffset, item.endOffset + 1);
					cursor = item.endOffset + 1;
				} else if (item.keepRaw) {
					result += rawContent.slice(item.startOffset, item.endOffset + 1);
					cursor = item.endOffset + 1;
				} else {
					result += this.#evaluateMacroNode(item.node, contentContext, item.scopedContent);
					if (item.scopedContent && item.scopedContent.closingEndOffset > item.endOffset) cursor = item.scopedContent.closingEndOffset + 1;
					else cursor = item.endOffset + 1;
				}
			}
			if (cursor < rawContent.length) result += rawContent.slice(cursor);
			return result;
		}
		/**
		* Computes the character range of a macro node based on its start/end tokens
		* or its own location if those are not available.
		*
		* @param {CstNode} macroNode
		* @returns {TokenRange}
		*/
		#getMacroRange(macroNode) {
			const startToken = ((macroNode.children || {})["Macro.Start"] || [])[0];
			const endToken = ((macroNode.children || {})["Macro.End"] || [])[0];
			if (startToken && endToken) return {
				startOffset: startToken.startOffset,
				endOffset: endToken.endOffset
			};
			if (macroNode.location) return {
				startOffset: macroNode.location.startOffset,
				endOffset: macroNode.location.endOffset
			};
			return {
				startOffset: 0,
				endOffset: 0
			};
		}
		/**
		* Flattens an incomplete macro node into document items.
		* Tokens from the incomplete macro become plaintext, but nested complete macros are preserved.
		*
		* @param {CstNode} macroNode
		* @param {IToken} excludeToken - The recovery-inserted token to exclude
		* @param {Array<DocumentItem>} items - The items array to add to
		*/
		#flattenIncompleteMacro(macroNode, excludeToken, items) {
			const children = macroNode.children || {};
			for (const key of Object.keys(children)) for (const element of children[key] || []) {
				if (element === excludeToken) continue;
				if ("startOffset" in element && typeof element.startOffset === "number") items.push({
					type: "plaintext",
					startOffset: element.startOffset,
					endOffset: element.endOffset ?? element.startOffset,
					token: element
				});
				else if ("children" in element) {
					const nestedChildren = element.children || {};
					const nestedEnd = (nestedChildren["Macro.End"] || [])[0];
					if ((nestedChildren["Macro.Start"] || [])[0] && nestedEnd) {
						if (!this.#isRecoveryToken(nestedEnd)) {
							const range = this.#getMacroRange(element);
							items.push({
								type: "macro",
								startOffset: range.startOffset,
								endOffset: range.endOffset,
								node: element
							});
						} else this.#flattenIncompleteMacro(element, nestedEnd, items);
					} else this.#flattenIncompleteMacro(element, excludeToken, items);
				}
			}
		}
		/**
		* Checks if a token was inserted during Chevrotain's error recovery.
		* Recovery tokens have `isInsertedInRecovery=true` or invalid offset values.
		*
		* @param {IToken|null|undefined} token
		* @returns {boolean}
		*/
		#isRecoveryToken(token) {
			return token?.isInsertedInRecovery === true || typeof token?.startOffset !== "number" || Number.isNaN(token?.startOffset);
		}
		/**
		* Computes the character range of an argument node based on all its child
		* tokens and nested macros.
		*
		* @param {CstNode} argNode
		* @returns {TokenRange|null}
		*/
		#getArgumentLocation(argNode) {
			const children = argNode.children || {};
			let startOffset = Number.POSITIVE_INFINITY;
			let endOffset = Number.NEGATIVE_INFINITY;
			for (const key of Object.keys(children)) for (const element of children[key] || []) if (this.#isCstNode(element)) {
				const location = element.location;
				if (!location) continue;
				if (location.startOffset < startOffset) startOffset = location.startOffset;
				if (location.endOffset > endOffset) endOffset = location.endOffset;
			} else if (element) {
				if (element.startOffset < startOffset) startOffset = element.startOffset;
				if (element.endOffset > endOffset) endOffset = element.endOffset;
			}
			if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) return null;
			return {
				startOffset,
				endOffset
			};
		}
		/**
		* Determines whether the given value is a CST node.
		*
		* @param {any} value
		* @returns {value is CstNode}
		*/
		#isCstNode(value) {
			return !!value && typeof value === "object" && "name" in value && "children" in value;
		}
		/**
		* Returns the positionally-first leaf token (by startOffset) across all children of a CST node.
		* Chevrotain groups tokens by type in the children object, so we must scan all type arrays
		* and pick the token with the smallest startOffset rather than assuming any one array is ordered first.
		*
		* @param {CstNode} node
		* @returns {IToken|null}
		*/
		#getFirstTokenInNode(node) {
			const children = node?.children || {};
			/** @type {IToken|null} */
			let first = null;
			for (const key of Object.keys(children)) for (const element of children[key] || []) {
				if (this.#isCstNode(element)) continue;
				const token = element;
				if (typeof token.startOffset !== "number" || isNaN(token.startOffset)) continue;
				if (first === null || token.startOffset < first.startOffset) first = token;
			}
			return first;
		}
		/**
		* Evaluates scoped content between an opening and closing macro tag.
		* This resolves any nested macros within the scoped content.
		*
		* @param {{ startOffset: number, endOffset: number }} scopedContent - The range of the scoped content.
		* @param {EvaluationContext} context - The evaluation context. The `text` property contains the parent
		*        document text, and offsets in scopedContent are relative to that parent text.
		* @returns {string} - The evaluated scoped content with nested macros resolved.
		*/
		#evaluateScopedContent(scopedContent, context) {
			const { text, contextOffset } = context;
			const { startOffset, endOffset } = scopedContent;
			const rawContent = text.slice(startOffset, endOffset + 1);
			const newContextOffset = contextOffset + startOffset;
			return this.#evaluateRawContent(rawContent, newContextOffset, context);
		}
		/**
		* Processes document items to find and merge scoped macro pairs.
		* A scoped macro is an opening macro followed by content and a closing macro.
		* Example: `{{setvar::myvar}}content{{/setvar}}` becomes `{{setvar::myvar::content}}`
		*
		* The closing macro has the `closingBlock` flag (`/`) and the same identifier.
		* Everything between the opening and closing macros becomes the last unnamed argument.
		*
		* @param {Array<DocumentItem>} items - The collected document items.
		* @param {string} text - The original document text.
		* @returns {Array<DocumentItem>} - The processed items with scoped macros merged.
		*/
		#processScopedMacros(items, text) {
			/** @type {Array<{ index: number, item: DocumentItemMacro, name: string, isClosing: boolean, matched: boolean }>} */
			const macroInfos = [];
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (item.type !== "macro") continue;
				const info = this.extractMacroInfo(item.node);
				if (!info) continue;
				macroInfos.push({
					index: i,
					item,
					name: info.name,
					isClosing: info.isClosing,
					matched: false
				});
			}
			/** @type {Array<{ openingIndex: number, closingIndex: number }>} */
			const pairs = [];
			/** @type {Set<number>} */
			const insideScope = /* @__PURE__ */ new Set();
			for (let i = 0; i < macroInfos.length; i++) {
				const openInfo = macroInfos[i];
				if (openInfo.isClosing || openInfo.matched || insideScope.has(openInfo.index)) continue;
				const closingIdx = this.#findMatchingClosingMacro(macroInfos, i);
				if (closingIdx === -1) continue;
				if (!this.#canAcceptScopedContent(openInfo.item.node, openInfo.name)) {
					openInfo.item.keepRaw = true;
					macroInfos[closingIdx].item.keepRaw = true;
					openInfo.matched = true;
					macroInfos[closingIdx].matched = true;
					continue;
				}
				openInfo.matched = true;
				macroInfos[closingIdx].matched = true;
				const closingIndex = macroInfos[closingIdx].index;
				pairs.push({
					openingIndex: openInfo.index,
					closingIndex
				});
				for (let j = openInfo.index + 1; j < closingIndex; j++) insideScope.add(j);
			}
			for (const info of macroInfos) if (info.isClosing && !info.matched) info.item.keepRaw = true;
			if (pairs.length === 0) return items;
			/** @type {Set<number>} */
			const itemsToRemove = /* @__PURE__ */ new Set();
			for (const pair of pairs) {
				const openingItem = items[pair.openingIndex];
				const closingItem = items[pair.closingIndex];
				openingItem.scopedContent = {
					startOffset: openingItem.endOffset + 1,
					endOffset: closingItem.startOffset - 1,
					closingEndOffset: closingItem.endOffset
				};
				itemsToRemove.add(pair.closingIndex);
				for (let j = pair.openingIndex + 1; j < pair.closingIndex; j++) itemsToRemove.add(j);
			}
			return items.filter((_, index) => !itemsToRemove.has(index));
		}
		/**
		* Checks if a macro can accept scoped content as an additional argument.
		* Returns true if adding one more argument would result in valid arity.
		*
		* @param {CstNode} macroNode - The macro CST node.
		* @param {string} macroName - The macro name.
		* @returns {boolean} - True if scoped content is allowed.
		*/
		#canAcceptScopedContent(macroNode, macroName) {
			const def = instance$2.getPrimaryMacro(macroName);
			if (!def) return true;
			const currentArgCount = (((((macroNode.children || {}).macroBody || [])[0]?.children || {}).arguments || [])[0]?.children?.argument || []).length;
			if (def.list) return false;
			const newArgCount = currentArgCount + 1;
			return newArgCount >= def.minArgs && newArgCount <= def.maxArgs;
		}
		/**
		* Finds the matching closing macro for an opening macro at the given index.
		* Handles nested scopes by tracking depth. Only counts opening macros that
		* can accept scoped content (inline macros with all args filled don't count).
		*
		* @param {Array<{ index: number, item: DocumentItemMacro, name: string, isClosing: boolean, matched: boolean }>} macroInfos
		* @param {number} openingIdx - Index in macroInfos array of the opening macro.
		* @returns {number} - Index in macroInfos array of the matching closing macro, or -1 if not found.
		*/
		#findMatchingClosingMacro(macroInfos, openingIdx) {
			const targetName = macroInfos[openingIdx].name;
			let depth = 1;
			for (let i = openingIdx + 1; i < macroInfos.length; i++) {
				const info = macroInfos[i];
				if (info.name.toLowerCase() !== targetName.toLowerCase()) continue;
				if (info.matched) continue;
				if (info.isClosing) {
					depth--;
					if (depth === 0) return i;
				} else if (this.#canAcceptScopedContent(info.item.node, info.name)) depth++;
			}
			return -1;
		}
	}.instance;
	// cache/upstream/sillytavern/public/scripts/macros/definitions/core-macros.js
	/**
	* Marker used by {{else}} to split content in {{if}} blocks.
	* Uses control characters to minimize collision with real content.
	*
	* This marker is used internally by the macro engine to separate if/else branches.
	* It should never appear in user-generated content.
	*
	* @type {string}
	*/
	var ELSE_MARKER = "\0ELSE\0";
	/**
	* Registers SillyTavern's core built-in macros in the MacroRegistry.
	*
	* These macros correspond to the main {{...}} macros that are available
	* in prompts (time/date/chat info, utility macros, etc.). They are
	* intended to preserve the behavior of the existing regex-based macros
	* in macros.js while using the new MacroRegistry/MacroEngine pipeline.
	*/
	function registerCoreMacros() {
		instance$2.registerMacro("space", {
			category: MacroCategory.UTILITY,
			unnamedArgs: [{
				name: "count",
				optional: true,
				defaultValue: "1",
				type: MacroValueType.INTEGER,
				description: "Number of spaces to insert."
			}],
			description: "Returns one or more spaces. One space by default, more if the count argument is specified.",
			returns: "One or more spaces.",
			exampleUsage: ["{{space}}", "{{space::4}}"],
			handler: ({ unnamedArgs: [count] }) => " ".repeat(Number(count ?? 1))
		});
		instance$2.registerMacro("newline", {
			category: MacroCategory.UTILITY,
			unnamedArgs: [{
				name: "count",
				optional: true,
				defaultValue: "1",
				type: MacroValueType.INTEGER,
				description: "Number of newlines to insert."
			}],
			description: "Inserts one or more newlines. One newline by default, more if the count argument is specified.",
			returns: "One or more \\n.",
			exampleUsage: ["{{newline}}", "{{newline::2}}"],
			handler: ({ unnamedArgs: [count] }) => "\n".repeat(Number(count ?? 1))
		});
		instance$2.registerMacro("noop", {
			category: MacroCategory.UTILITY,
			description: "Does nothing and produces an empty string.",
			returns: "",
			handler: () => ""
		});
		instance$2.registerMacro("trim", {
			category: MacroCategory.UTILITY,
			description: "Trims whitespace. Non-scoped: trims newlines around the macro (post-processing). Scoped: returns the content (auto-trimmed by the engine).",
			unnamedArgs: [{
				name: "content",
				description: "Content to trim (when used as scoped macro)",
				optional: true
			}],
			returns: "",
			handler: ({ unnamedArgs: [content], isScoped }) => {
				if (isScoped) return content ?? "";
				return "{{trim}}";
			}
		});
		/**
		* Splits raw content on the first {{else}} macro at nesting depth 0.
		* Tracks scoped {{if}}/{{/if}} pairs to find the correct top-level else.
		* Only {{if}} with 1 argument (condition only) are considered scoped blocks.
		*
		* @param {string} content - The raw content to split
		* @returns {{ thenBranch: string, elseBranch: string | undefined }}
		*/
		function splitOnTopLevelElse(content) {
			const { cst } = instance$3.parseDocument(content);
			const macroNodes = cst?.children?.macro || [];
			let depth = 0;
			for (const macroNode of macroNodes) {
				const info = instance$1.extractMacroInfo(macroNode);
				if (!info) continue;
				if (info.name === "if" && !info.isClosing && info.argCount === 1) depth++;
				else if (info.name === "if" && info.isClosing) depth--;
				else if (info.name === "else" && depth === 0) return {
					thenBranch: content.slice(0, info.startOffset),
					elseBranch: content.slice(info.endOffset + 1)
				};
			}
			return {
				thenBranch: content,
				elseBranch: void 0
			};
		}
		instance$2.registerMacro("if", {
			category: MacroCategory.UTILITY,
			description: "Conditional macro. Returns the content if the condition is truthy, otherwise returns nothing (or the else branch if present). Prefix the condition with ! to invert. If the condition is a registered macro name (without braces), it will be resolved first. Variable shorthands (.varname for local, $varname for global) are also supported.",
			unnamedArgs: [{
				name: "condition",
				description: "The condition to evaluate. Prefix with ! to invert. Can be a macro name (auto-resolved), variable shorthand (.var or $var), or a value. Falsy: empty string, \"false\", \"off\", \"0\"."
			}, {
				name: "content",
				description: "The content to return if condition is truthy (typically provided as scoped content). May contain {{else}} to define an else branch."
			}],
			displayOverride: "{{if condition}}then{{else}}other{{/if}}",
			exampleUsage: [
				"{{if description}}# Description\n{{description}}{{/if}}",
				"{{if charVersion}}{{charVersion}}{{else}}No version{{/if}}",
				"{{if !personality}}No personality defined{{/if}}",
				"{{if {{getvar::showHeader}}}}# Header{{/if}}",
				"{{if .myvar}}Local var exists{{/if}}",
				"{{if $globalFlag}}Global flag is set{{/if}}"
			],
			returns: "The content if condition is truthy, else branch or empty string otherwise.",
			delayArgResolution: true,
			handler: ({ unnamedArgs: [rawCondition, rawContent], flags, resolve, trimContent }) => {
				let inverted = false;
				let condition = rawCondition;
				if (/^\s*!/.test(rawCondition)) {
					inverted = true;
					condition = rawCondition.replace(/^\s*!\s*/, "");
				}
				condition = resolve(condition);
				const varShorthandRegex = new RegExp(`^([.$])(${MACRO_VARIABLE_SHORTHAND_PATTERN.source})$`);
				const varShorthandMatch = condition.match(varShorthandRegex);
				if (varShorthandMatch) {
					const [, prefix, varName] = varShorthandMatch;
					condition = resolve(`{{${prefix === "." ? "getvar" : "getglobalvar"}::${varName}}}`);
				} else {
					const macroDef = instance$2.getPrimaryMacro(condition);
					if (macroDef && macroDef.minArgs === 0) condition = resolve(`{{${condition}}}`);
				}
				let isFalsy = condition === "" || isFalseBoolean(condition);
				if (inverted) isFalsy = !isFalsy;
				const { thenBranch, elseBranch } = splitOnTopLevelElse(rawContent);
				const chosenBranch = !isFalsy ? thenBranch : elseBranch;
				if (chosenBranch === void 0) return "";
				let result = resolve(chosenBranch);
				if (!flags.preserveWhitespace) result = trimContent(result);
				return result;
			}
		});
		instance$2.registerMacro("else", {
			category: MacroCategory.UTILITY,
			description: "Marks the else branch inside a scoped {{if}} block. Only works inside {{if}}...{{/if}}. If used outside, returns an invisible marker.",
			exampleUsage: ["{{if condition}}true branch{{else}}false branch{{/if}}"],
			returns: "Invisible marker (consumed by the enclosing {{if}} macro).",
			handler: () => ELSE_MARKER
		});
		instance$2.registerMacro("input", {
			category: MacroCategory.UTILITY,
			description: "Current text from the send textarea.",
			returns: "Current text from the send textarea.",
			handler: () => document.querySelector("#send_textarea")?.value ?? ""
		});
		instance$2.registerMacro("maxPrompt", {
			aliases: [{
				alias: "maxPromptTokens",
				visible: true
			}],
			category: MacroCategory.STATE,
			description: "Maximum prompt context size.",
			returns: "Maximum prompt context size.",
			returnType: MacroValueType.INTEGER,
			handler: () => String(getMaxPromptTokens())
		});
		instance$2.registerMacro("maxContext", {
			aliases: [{
				alias: "maxContextTokens",
				visible: true
			}],
			category: MacroCategory.STATE,
			description: "Maximum context token limit.",
			returns: "Maximum context token limit.",
			returnType: MacroValueType.INTEGER,
			handler: () => String(getMaxContextTokens())
		});
		instance$2.registerMacro("maxResponse", {
			aliases: [{
				alias: "maxResponseTokens",
				visible: true
			}],
			category: MacroCategory.STATE,
			description: "Maximum response token limit.",
			returns: "Maximum response token limit.",
			returnType: MacroValueType.INTEGER,
			handler: () => String(getMaxResponseTokens())
		});
		instance$2.registerMacro("reverse", {
			category: MacroCategory.UTILITY,
			unnamedArgs: [{
				name: "value",
				type: MacroValueType.STRING,
				description: "The string to reverse."
			}],
			description: "Reverses the characters of the argument provided.",
			returns: "Reversed string.",
			exampleUsage: ["{{reverse::I am Lana}}"],
			handler: ({ unnamedArgs: [value] }) => Array.from(value).reverse().join("")
		});
		instance$2.registerMacro("//", {
			aliases: [{
				alias: "comment",
				visible: false
			}],
			category: MacroCategory.UTILITY,
			unnamedArgs: [{
				name: "comment",
				type: MacroValueType.STRING,
				description: "Any kind of text as comment. If you want multiline comments, consider using a scoped macro like {{//}}First\nSecond{{///}}."
			}],
			description: "Comment macro that produces an empty string. Can be used for writing into prompt definitions, without being passed to the context.",
			returns: "",
			displayOverride: "{{// ...}}",
			exampleUsage: ["{{// This is a comment}}"],
			handler: () => ""
		});
		instance$2.registerMacro("roll", {
			category: MacroCategory.RANDOM,
			unnamedArgs: [{
				name: "formula",
				sampleValue: "1d20",
				description: "Dice roll formula using droll syntax (e.g. 1d20).",
				type: "string"
			}],
			description: "Rolls dice using droll syntax (e.g. {{roll 1d20}}).",
			returns: "Dice roll result.",
			returnType: MacroValueType.INTEGER,
			exampleUsage: [
				"{{roll::1d20}}",
				"{{roll::6}}",
				"{{roll::3d6+4}}"
			],
			handler: ({ unnamedArgs: [formula], warn }) => {
				if (/^\d+$/.test(formula)) formula = `1d${formula}`;
				if (!droll.default.validate(formula)) {
					warn(`Invalid roll formula: ${formula}`);
					return "";
				}
				const result = droll.default.roll(formula);
				if (result === false) return "";
				return String(result.total);
			}
		});
		instance$2.registerMacro("random", {
			category: MacroCategory.RANDOM,
			list: true,
			description: "Picks a random item from a list. Will be re-rolled every time macros are resolved.",
			returns: "Randomly selected item from the list.",
			exampleUsage: ["{{random::blonde::brown::red::black::blue}}"],
			handler: ({ list }) => {
				if (list.length === 1) list = readSingleArgsRandomList(list[0]);
				if (list.length === 0) return "";
				const rng = (0, seedrandom.default)("added entropy.", { entropy: true });
				const randomIndex = Math.floor(rng() * list.length);
				return list[randomIndex];
			}
		});
		instance$2.registerMacro("pick", {
			category: MacroCategory.RANDOM,
			list: true,
			description: "Picks a random item from a list, but keeps the choice stable for a given chat and macro position. Can be rerolled via /reroll-pick slash command.",
			returns: "Stable randomly selected item from the list.",
			exampleUsage: ["{{pick::blonde::brown::red::black::blue}}"],
			handler: ({ list, globalOffset, env }) => {
				if (list.length === 1) list = readSingleArgsRandomList(list[0]);
				if (!list.length) return "";
				const finalSeed = getStringHash([
					getChatIdHash(),
					env.contentHash,
					globalOffset,
					chat_metadata.pick_reroll_seed || null
				].filter((it) => it !== null).join("-"));
				const rng = (0, seedrandom.default)(String(finalSeed));
				const randomIndex = Math.floor(rng() * list.length);
				return list[randomIndex];
			}
		});
		/** @param {string} listString @return {string[]} */
		function readSingleArgsRandomList(listString) {
			if (listString.includes("::")) return listString.split("::").map((item) => item.trim());
			return listString.replace(/\\,/g, "##�COMMA�##").split(",").map((item) => item.trim().replace(/##�COMMA�##/g, ","));
		}
		instance$2.registerMacro("banned", {
			category: MacroCategory.UTILITY,
			unnamedArgs: [{
				name: "word",
				sampleValue: "word",
				description: "Word to ban for Text Completion backend.",
				type: "string"
			}],
			description: "Bans a word for Text Completion backend. (Strips quotes surrounding the banned word, if present)",
			returns: "",
			exampleUsage: ["{{banned::delve}}"],
			handler: ({ unnamedArgs: [bannedWord] }) => {
				bannedWord = bannedWord.replace(/^"|"$/g, "");
				return "";
			}
		});
		instance$2.registerMacro("outlet", {
			category: MacroCategory.UTILITY,
			unnamedArgs: [{
				name: "key",
				sampleValue: "my-outlet-key",
				description: "Outlet key.",
				type: "string"
			}],
			description: "Returns the world info outlet prompt for a given outlet key.",
			returns: "World info outlet prompt.",
			exampleUsage: ["{{outlet::character-achievements}}"],
			handler: ({ unnamedArgs: [outlet] }) => {
				if (!outlet) return "";
				return extension_prompts[inject_ids.CUSTOM_WI_OUTLET(outlet)]?.value || "";
			}
		});
	}
	function getChatIdHash() {
		const cachedIdHash = chat_metadata.chat_id_hash;
		if (typeof cachedIdHash === "number") return cachedIdHash;
		const chatIdHash = getStringHash(chat_metadata.main_chat ?? getCurrentChatId());
		chat_metadata.chat_id_hash = chatIdHash;
		return chatIdHash;
	}
	// cache/upstream/sillytavern/public/scripts/macros/engine/MacroEngine.js
	/** @typedef {import('./MacroCstWalker.js').MacroCall} MacroCall */
	/** @typedef {import('./MacroEnv.types.js').MacroEnv} MacroEnv */
	/** @typedef {import('./MacroRegistry.js').MacroDefinitionOptions} MacroDefinitionOptions */
	/** @typedef {import('./MacroRegistry.js').MacroDefinition} MacroDefinition */
	/**
	* A processor function that transforms text before or after macro evaluation.
	*
	* @callback MacroProcessor
	* @param {string} text - The text to process.
	* @param {MacroEnv} env - The macro environment.
	* @returns {string} The processed text.
	*/
	/**
	* @typedef {Object} RegisteredProcessor
	* @property {MacroProcessor} handler - The processor function.
	* @property {number} priority - Execution priority (lower = earlier).
	* @property {string} source - Identifier for debugging/tracking.
	*/
	/**
	* The singleton instance of the MacroEngine.
	*
	* @type {MacroEngine}
	*/
	var instance = class MacroEngine {
		/** @type {MacroEngine} */ static #instance;
		/** @type {MacroEngine} */ static get instance() {
			return MacroEngine.#instance ?? (MacroEngine.#instance = new MacroEngine());
		}
		/** @type {RegisteredProcessor[]} */
		#preProcessors = [];
		/** @type {RegisteredProcessor[]} */
		#postProcessors = [];
		constructor() {
			this.#registerCorePreProcessors();
			this.#registerCorePostProcessors();
		}
		/**
		* Registers a pre-processor to run before macro evaluation.
		*
		* @param {MacroProcessor} handler - The processor function.
		* @param {Object} [options] - Configuration options.
		* @param {number} [options.priority=100] - Execution priority (lower = earlier).
		* @param {string} [options.source='unknown'] - Identifier for debugging.
		*/
		addPreProcessor(handler, { priority = 100, source = "unknown" } = {}) {
			this.#preProcessors.push({
				handler,
				priority,
				source
			});
			this.#preProcessors.sort((a, b) => a.priority - b.priority);
		}
		/**
		* Removes a previously registered pre-processor.
		*
		* @param {MacroProcessor} handler - The processor function to remove.
		* @returns {boolean} True if the processor was found and removed.
		*/
		removePreProcessor(handler) {
			const index = this.#preProcessors.findIndex((p) => p.handler === handler);
			if (index !== -1) {
				this.#preProcessors.splice(index, 1);
				return true;
			}
			return false;
		}
		/**
		* Registers a post-processor to run after macro evaluation.
		*
		* @param {MacroProcessor} handler - The processor function.
		* @param {Object} [options] - Configuration options.
		* @param {number} [options.priority=100] - Execution priority (lower = earlier).
		* @param {string} [options.source='unknown'] - Identifier for debugging.
		*/
		addPostProcessor(handler, { priority = 100, source = "unknown" } = {}) {
			this.#postProcessors.push({
				handler,
				priority,
				source
			});
			this.#postProcessors.sort((a, b) => a.priority - b.priority);
		}
		/**
		* Removes a previously registered post-processor.
		*
		* @param {MacroProcessor} handler - The processor function to remove.
		* @returns {boolean} True if the processor was found and removed.
		*/
		removePostProcessor(handler) {
			const index = this.#postProcessors.findIndex((p) => p.handler === handler);
			if (index !== -1) {
				this.#postProcessors.splice(index, 1);
				return true;
			}
			return false;
		}
		/**
		* Evaluates a string containing macros and resolves them.
		*
		* @param {string} input - The input string to evaluate.
		* @param {MacroEnv} env - The environment to pass to the macro handler.
		* @param {Object} [options={}] - Optional evaluation settings.
		* @param {number} [options.contextOffset=0] - Base offset from the original top-level document.
		*        Used when evaluating nested content (via resolve() in handlers) to preserve global
		*        positioning for macros like {{pick}} that seed on position.
		* @returns {string} The resolved string.
		*/
		evaluate(input, env, { contextOffset = 0 } = {}) {
			if (!input) return "";
			const safeEnv = Object.freeze({ ...env });
			const preProcessed = this.#runPreProcessors(input, safeEnv);
			const { cst, lexingErrors, parserErrors } = instance$3.parseDocument(preProcessed);
			if (lexingErrors && lexingErrors.length > 0) logMacroSyntaxWarning({
				phase: "lexing",
				input,
				errors: lexingErrors
			});
			if (parserErrors && parserErrors.length > 0) logMacroSyntaxWarning({
				phase: "parsing",
				input,
				errors: parserErrors
			});
			if (!cst || typeof cst !== "object" || !cst.children) {
				logMacroGeneralError({
					message: "Macro parser produced an invalid CST. Returning original input.",
					error: {
						input,
						lexingErrors,
						parserErrors
					}
				});
				return input;
			}
			let evaluated;
			try {
				evaluated = instance$1.evaluateDocument({
					text: preProcessed,
					contextOffset,
					cst,
					env: safeEnv,
					resolveMacro: this.#resolveMacro.bind(this),
					trimContent: this.trimScopedContent.bind(this)
				});
			} catch (error) {
				logMacroGeneralError({
					message: "Macro evaluation failed. Returning original input.",
					error: {
						input,
						error
					}
				});
				return input;
			}
			return this.#runPostProcessors(evaluated, safeEnv);
		}
		/**
		* Resolves a macro call.
		*
		* @param {MacroCall} call - The macro call to resolve.
		* @returns {string} The resolved macro.
		*/
		#resolveMacro(call) {
			const { name, env } = call;
			const raw = `{{${call.rawInner}}}`;
			if (!name) return raw;
			/** @type {MacroDefinition|null} */
			let defOverride = null;
			const nameLower = name.toLowerCase();
			if (Object.hasOwn(env.dynamicMacros, nameLower)) {
				const impl = env.dynamicMacros[nameLower];
				if (impl && typeof impl === "object" && "handler" in impl && typeof impl.handler === "function") try {
					const options = impl;
					defOverride = instance$2.buildMacroDefFromOptions(name, options);
				} catch (error) {
					logMacroRuntimeWarning({
						message: `Dynamic macro "${name}" has invalid options: ${error.message}`,
						call
					});
				}
				else if ([
					"string",
					"number",
					"boolean",
					"function"
				].includes(typeof impl)) {
					if (["number", "boolean"].includes(typeof impl)) logMacroRuntimeWarning({
						message: `Dynamic macro "${name}" uses unsupported number/boolean format.`,
						call
					});
					defOverride = instance$2.buildMacroDefFromOptions(name, {
						handler: typeof impl === "function" ? impl : () => String(impl ?? ""),
						category: "dynamic",
						description: "Dynamic macro",
						returnType: MacroValueType.STRING
					});
				} else logMacroRuntimeWarning({
					message: `Dynamic macro "${name}" is not defined correctly (must be string, a handler function, or a macro def options object with handler property).`,
					call
				});
			}
			if (!defOverride && !instance$2.hasMacro(name)) return raw;
			try {
				const result = instance$2.executeMacro(call, { defOverride });
				try {
					return call.env.functions.postProcess(result);
				} catch (error) {
					logMacroInternalError({
						message: `Macro "${name}" postProcess function failed.`,
						call,
						error
					});
					return result;
				}
			} catch (error) {
				if (!!(error && (error.name === "MacroRuntimeError" || error.isMacroRuntimeError))) logMacroRuntimeWarning({
					message: error.message || `Macro "${name}" execution failed.`,
					call,
					error
				});
				else logMacroInternalError({
					message: `Macro "${name}" internal execution error.`,
					call,
					error
				});
				return raw;
			}
		}
		/**
		* Runs pre-processors on the input text, before the engine processes the input.
		*
		* @param {string} text - The input text to process.
		* @param {MacroEnv} env - The environment to pass to the macro handler.
		* @returns {string} The processed text.
		*/
		#runPreProcessors(text, env) {
			let result = text;
			for (const { handler } of this.#preProcessors) result = handler(result, env);
			return result;
		}
		/**
		* Runs post-processors on the input text, after the engine finished processing the input.
		*
		* @param {string} text - The input text to process.
		* @param {MacroEnv} env - The environment to pass to the macro handler.
		* @returns {string} The processed text.
		*/
		#runPostProcessors(text, env) {
			let result = text;
			for (const { handler } of this.#postProcessors) result = handler(result, env);
			return result;
		}
		/**
		* Registers the core pre/post processors that handle legacy syntax and cleanup.
		*/
		#registerCorePreProcessors() {
			this.addPreProcessor((text) => text.replace(/{{time_(UTC[+-]\d+)}}/gi, (_match, utcOffset) => `{{time::${utcOffset}}}`), {
				priority: 10,
				source: "core:legacy-time-syntax"
			});
			this.addPreProcessor((text) => text.replace(/<USER>/gi, "{{user}}").replace(/<BOT>/gi, "{{char}}").replace(/<CHAR>/gi, "{{char}}").replace(/<GROUP>/gi, "{{group}}").replace(/<CHARIFNOTGROUP>/gi, "{{charIfNotGroup}}"), {
				priority: 20,
				source: "core:legacy-markers"
			});
		}
		/**
		* Registers the core post-processors that handle legacy syntax and cleanup.
		*/
		#registerCorePostProcessors() {
			this.addPostProcessor((text) => text.replace(/\\([{}])/g, "$1"), {
				priority: 10,
				source: "core:unescape-braces"
			});
			this.addPostProcessor((text) => text.replace(/(?:\r?\n)*{{trim}}(?:\r?\n)*/gi, ""), {
				priority: 20,
				source: "core:legacy-trim"
			});
			this.addPostProcessor((text) => text.replaceAll(ELSE_MARKER, ""), {
				priority: 30,
				source: "core:cleanup-else-marker"
			});
		}
		/**
		* Normalizes macro results into a string.
		* This mirrors the behavior of the legacy macro system in a simplified way.
		*
		* @param {any} value
		* @returns {string}
		*/
		normalizeMacroResult(value) {
			if (value === null || value === void 0) return "";
			if (value instanceof Date) return value.toISOString();
			if (typeof value === "object" || Array.isArray(value)) try {
				return JSON.stringify(value);
			} catch (_error) {
				return String(value);
			}
			return String(value);
		}
		/**
		* Trims scoped content with optional indentation dedent.
		*
		* When trimIndent is true (default), this function:
		* 1. Trims leading and trailing whitespace (like String.trim())
		* 2. Finds the indentation of the first non-empty line
		* 3. Removes that amount of leading whitespace from all subsequent lines
		*
		* This allows neatly formatted scoped macros like:
		* ```
		* {{if condition}}
		*   # Heading
		*   Content here
		* {{/if}}
		* ```
		* To produce "# Heading\nContent here" instead of "# Heading\n  Content here"
		*
		* @param {string} content - The content to trim
		* @param {Object} options - Configuration options
		* @param {boolean} [options.trimIndent=true] - Whether to also dedent consistent indentation
		* @returns {string} The trimmed content
		*/
		trimScopedContent(content, { trimIndent = true } = {}) {
			if (!content) return "";
			if (!trimIndent) return content.trim();
			const lines = content.split("\n");
			let baseIndent = 0;
			for (const line of lines) if (line.trim() !== "") {
				const match = line.match(/^[ \t]*/);
				baseIndent = match ? match[0].length : 0;
				break;
			}
			if (baseIndent === 0) return content.trim();
			return lines.map((line) => {
				const match = line.match(/^[ \t]*/);
				if ((match ? match[0].length : 0) >= baseIndent) return line.slice(baseIndent);
				return line.trimStart();
			}).join("\n").trim();
		}
	}.instance;
	// cache/upstream/sillytavern/public/scripts/macros/definitions/variable-macros.js
	/**
	* Registers variable-related {{...}} macros that operate on local and global
	* variables (e.g. {{setvar}}, {{getvar}}, {{incvar}}, etc.).
	*/
	function registerVariableMacros() {
		const ctx = SillyTavern.getContext();
		instance$2.registerMacro("setvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the local variable to set."
			}, {
				name: "value",
				type: [MacroValueType.STRING, MacroValueType.NUMBER],
				description: "The value to set the local variable to."
			}],
			description: "Sets a local variable to the given value.",
			returns: "",
			exampleUsage: ["{{setvar::myvar::foo}}", "{{setvar::myintvar::3}}"],
			handler: ({ unnamedArgs: [name, value] }) => {
				ctx.variables.local.set(name, value);
				return "";
			}
		});
		instance$2.registerMacro("addvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the local variable to add to."
			}, {
				name: "value",
				type: [MacroValueType.STRING, MacroValueType.NUMBER],
				description: "The value to add to the local variable."
			}],
			description: "Adds a value to an existing local variable (numeric or string append). If the variable does not exist, it will be created.",
			returns: "",
			exampleUsage: ["{{addvar::mystrvar::foo}}", "{{addvar::myintvar::3}}"],
			handler: ({ unnamedArgs: [name, value] }) => {
				ctx.variables.local.add(name, value);
				return "";
			}
		});
		instance$2.registerMacro("incvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the local variable to increment."
			}],
			description: "Increments a local variable by 1 and returns the new value. If the variable does not exist, it will be created.",
			returns: "The new value of the local variable.",
			returnType: MacroValueType.NUMBER,
			exampleUsage: ["{{incvar::myintvar}}", "{{incvar some-local-int-var}}"],
			handler: ({ unnamedArgs: [name], normalize }) => {
				return normalize(ctx.variables.local.inc(name));
			}
		});
		instance$2.registerMacro("decvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the local variable to decrement."
			}],
			description: "Decrements a local variable by 1 and returns the new value. If the variable does not exist, it will be created.",
			returns: "The new value of the local variable.",
			returnType: MacroValueType.NUMBER,
			exampleUsage: ["{{decvar::myintvar}}", "{{decvar some-local-int-var}}"],
			handler: ({ unnamedArgs: [name], normalize }) => {
				return normalize(ctx.variables.local.dec(name));
			}
		});
		instance$2.registerMacro("getvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the local variable to get."
			}],
			description: "Gets the value of a local variable.",
			returns: "The value of the local variable.",
			returnType: [MacroValueType.STRING, MacroValueType.NUMBER],
			exampleUsage: ["{{getvar::myvar}}", "{{getvar myintvar}}"],
			handler: ({ unnamedArgs: [name], normalize }) => {
				return normalize(ctx.variables.local.get(name));
			}
		});
		instance$2.registerMacro("hasvar", {
			aliases: [{ alias: "varexists" }],
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the local variable to check."
			}],
			description: "Checks if a local variable exists.",
			returns: "\"true\" if the variable exists, \"false\" otherwise.",
			returnType: MacroValueType.STRING,
			exampleUsage: ["{{hasvar::myvar}}", "{{hasvar some-local-var}}"],
			handler: ({ unnamedArgs: [name] }) => {
				return ctx.variables.local.has(name) ? "true" : "false";
			}
		});
		instance$2.registerMacro("deletevar", {
			aliases: [{ alias: "flushvar" }],
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the local variable to delete."
			}],
			description: "Deletes a local variable.",
			returns: "",
			exampleUsage: ["{{deletevar::myvar}}", "{{deletevar some-local-var}}"],
			handler: ({ unnamedArgs: [name] }) => {
				ctx.variables.local.del(name);
				return "";
			}
		});
		instance$2.registerMacro("setvarkey", {
			aliases: [{ alias: "setvarindex" }],
			category: MacroCategory.VARIABLE,
			unnamedArgs: [
				{
					name: "name",
					type: MacroValueType.STRING,
					description: "The name of the local object or array."
				},
				{
					name: "key",
					type: [MacroValueType.STRING, MacroValueType.NUMBER],
					description: "The key of an object or the index of an array."
				},
				{
					name: "value",
					type: [MacroValueType.STRING, MacroValueType.NUMBER],
					description: "The value to set at the specified key or index."
				}
			],
			description: "Sets a value at a specific key or index in a local object or array. If the variable does not exist, it will be created based on the type of the key.",
			returns: "",
			exampleUsage: ["{{setvarkey::myarray::0::foo}}", "{{setvarkey::myobj::uniquekey::somevalue}}"],
			handler: ({ unnamedArgs: [name, key, value] }) => {
				ctx.variables.local.set(name, value, { index: key });
				return "";
			}
		});
		instance$2.registerMacro("getvarkey", {
			aliases: [{ alias: "getvarindex" }],
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the local object or array variable to get from."
			}, {
				name: "key",
				type: [MacroValueType.STRING, MacroValueType.NUMBER],
				description: "The key of an object or the index of an array."
			}],
			description: "Gets a value at a specific key or index in a local object or array variable.",
			returns: "The value at the specified key or index in the local object or array variable.",
			returnType: [MacroValueType.STRING, MacroValueType.NUMBER],
			exampleUsage: ["{{getvarkey::myarray::0}}", "{{getvarkey::myobj::uniquekey}}"],
			handler: ({ unnamedArgs: [name, key], normalize }) => {
				return normalize(ctx.variables.local.get(name, { index: key }));
			}
		});
		instance$2.registerMacro("setglobalvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the global variable to set."
			}, {
				name: "value",
				type: [MacroValueType.STRING, MacroValueType.NUMBER],
				description: "The value to set the global variable to."
			}],
			description: "Sets a global variable to the given value.",
			returns: "",
			exampleUsage: ["{{setglobalvar::myvar::foo}}", "{{setglobalvar::myintvar::3}}"],
			handler: ({ unnamedArgs: [name, value] }) => {
				ctx.variables.global.set(name, value);
				return "";
			}
		});
		instance$2.registerMacro("addglobalvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the global variable to add to."
			}, {
				name: "value",
				type: [MacroValueType.STRING, MacroValueType.NUMBER],
				description: "The value to add to the global variable."
			}],
			description: "Adds a value to an existing global variable (numeric or string append). If the variable does not exist, it will be created.",
			returns: "",
			exampleUsage: ["{{addglobalvar::mystrvar::foo}}", "{{addglobalvar::myintvar::3}}"],
			handler: ({ unnamedArgs: [name, value] }) => {
				ctx.variables.global.add(name, value);
				return "";
			}
		});
		instance$2.registerMacro("incglobalvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the global variable to increment."
			}],
			description: "Increments a global variable by 1 and returns the new value. If the variable does not exist, it will be created.",
			returns: "The new value of the global variable.",
			returnType: MacroValueType.NUMBER,
			exampleUsage: ["{{incglobalvar::myintvar}}", "{{incglobalvar some-global-int-var}}"],
			handler: ({ unnamedArgs: [name], normalize }) => {
				return normalize(ctx.variables.global.inc(name));
			}
		});
		instance$2.registerMacro("decglobalvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the global variable to decrement."
			}],
			description: "Decrements a global variable by 1 and returns the new value. If the variable does not exist, it will be created.",
			returns: "The new value of the global variable.",
			returnType: MacroValueType.NUMBER,
			exampleUsage: ["{{decglobalvar::myintvar}}", "{{decglobalvar some-global-int-var}}"],
			handler: ({ unnamedArgs: [name], normalize }) => {
				return normalize(ctx.variables.global.dec(name));
			}
		});
		instance$2.registerMacro("getglobalvar", {
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the global variable to get."
			}],
			description: "Gets the value of a global variable.",
			returns: "The value of the global variable.",
			returnType: [MacroValueType.STRING, MacroValueType.NUMBER],
			exampleUsage: ["{{getglobalvar::myvar}}", "{{getglobalvar myintvar}}"],
			handler: ({ unnamedArgs: [name], normalize }) => {
				return normalize(ctx.variables.global.get(name));
			}
		});
		instance$2.registerMacro("hasglobalvar", {
			aliases: [{ alias: "globalvarexists" }],
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the global variable to check."
			}],
			description: "Checks if a global variable exists.",
			returns: "\"true\" if the variable exists, \"false\" otherwise.",
			returnType: MacroValueType.STRING,
			exampleUsage: ["{{hasglobalvar::myvar}}", "{{hasglobalvar some-global-var}}"],
			handler: ({ unnamedArgs: [name] }) => {
				return ctx.variables.global.has(name) ? "true" : "false";
			}
		});
		instance$2.registerMacro("deleteglobalvar", {
			aliases: [{ alias: "flushglobalvar" }],
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the global variable to delete."
			}],
			description: "Deletes a global variable.",
			returns: "",
			exampleUsage: ["{{deleteglobalvar::myvar}}", "{{deleteglobalvar some-global-var}}"],
			handler: ({ unnamedArgs: [name] }) => {
				ctx.variables.global.del(name);
				return "";
			}
		});
		instance$2.registerMacro("setglobalvarkey", {
			aliases: [{ alias: "setglobalvarindex" }],
			category: MacroCategory.VARIABLE,
			unnamedArgs: [
				{
					name: "name",
					type: MacroValueType.STRING,
					description: "The name of the global object or array variable."
				},
				{
					name: "key",
					type: [MacroValueType.STRING, MacroValueType.NUMBER],
					description: "The key of an object or the index of an array element to set."
				},
				{
					name: "value",
					type: [MacroValueType.STRING, MacroValueType.NUMBER],
					description: "The value to set at the specified key or index."
				}
			],
			description: "Sets a value at a specific key or index in a global object or array variable. If the variable does not exist, it will be created based on the type of the key.",
			returns: "",
			exampleUsage: ["{{setglobalvarkey::myarray::0::foo}}", "{{setglobalvarkey::myobj::uniquekey::bar}}"],
			handler: ({ unnamedArgs: [name, key, value] }) => {
				ctx.variables.global.set(name, value, { index: key });
				return "";
			}
		});
		instance$2.registerMacro("getglobalvarkey", {
			aliases: [{ alias: "getglobalvarindex" }],
			category: MacroCategory.VARIABLE,
			unnamedArgs: [{
				name: "name",
				type: MacroValueType.STRING,
				description: "The name of the global object or array variable to get from."
			}, {
				name: "key",
				type: [MacroValueType.STRING, MacroValueType.NUMBER],
				description: "The key of an object or the index of an array element to get."
			}],
			description: "Gets a value at a specific key or index in a global object or array variable.",
			returns: "The value at the specified key or index in the global object or array variable.",
			returnType: [MacroValueType.STRING, MacroValueType.NUMBER],
			exampleUsage: ["{{getglobalvarkey::myarray::0}}", "{{getglobalvarkey::myobj::uniquekey}}"],
			handler: ({ unnamedArgs: [name, key], normalize }) => {
				return normalize(ctx.variables.global.get(name, { index: key }));
			}
		});
	}
	// cache/upstream/sillytavern/public/scripts/macros/definitions/env-macros.js
	/** @typedef {import('../engine/MacroEnv.types.js').MacroEnv} MacroEnv */
	/**
	* Registers macros that mostly act as simple accessors to MacroEnv fields
	* (names, character card fields, system metadata, extras) or basic
	* environment flags.
	*/
	function registerEnvMacros() {
		instance$2.registerMacro("user", {
			category: MacroCategory.NAMES,
			description: "Your current Persona username.",
			returns: "Persona username.",
			handler: ({ env }) => env.names.user
		});
		instance$2.registerMacro("char", {
			category: MacroCategory.NAMES,
			description: "The character's name.",
			returns: "Character name.",
			handler: ({ env }) => env.names.char
		});
		instance$2.registerMacro("group", {
			aliases: [{
				alias: "charIfNotGroup",
				visible: false
			}],
			category: MacroCategory.NAMES,
			description: "Comma-separated list of group member names (including muted) or the character name in solo chats.",
			returns: "List of group member names.",
			handler: ({ env }) => env.names.group ?? ""
		});
		instance$2.registerMacro("groupNotMuted", {
			category: MacroCategory.NAMES,
			description: "Comma-separated list of group member names excluding muted members.",
			returns: "List of group member names excluding muted members.",
			handler: ({ env }) => env.names.groupNotMuted ?? ""
		});
		instance$2.registerMacro("notChar", {
			category: MacroCategory.NAMES,
			description: "Comma-separated list of all participants except the current speaker.",
			returns: "List of all participants except the current speaker.",
			handler: ({ env }) => env.names.notChar ?? ""
		});
		instance$2.registerMacro("charPrompt", {
			category: MacroCategory.CHARACTER,
			description: "The character's Main Prompt override.",
			returns: "Character Main Prompt override.",
			handler: ({ env }) => env.character.charPrompt ?? ""
		});
		instance$2.registerMacro("charInstruction", {
			category: MacroCategory.CHARACTER,
			description: "The character's Post-History Instructions override.",
			returns: "Character Post-History Instructions override.",
			handler: ({ env }) => env.character.charInstruction ?? ""
		});
		instance$2.registerMacro("charDescription", {
			aliases: [{ alias: "description" }],
			category: MacroCategory.CHARACTER,
			description: "The character's description.",
			returns: "Character description.",
			handler: ({ env }) => env.character.description ?? ""
		});
		instance$2.registerMacro("charPersonality", {
			aliases: [{ alias: "personality" }],
			category: MacroCategory.CHARACTER,
			description: "The character's personality.",
			returns: "Character personality.",
			handler: ({ env }) => env.character.personality ?? ""
		});
		instance$2.registerMacro("charScenario", {
			aliases: [{ alias: "scenario" }],
			category: MacroCategory.CHARACTER,
			description: "The character's scenario.",
			returns: "Character scenario.",
			handler: ({ env }) => env.character.scenario ?? ""
		});
		instance$2.registerMacro("persona", {
			category: MacroCategory.CHARACTER,
			description: "Your current Persona description.",
			returns: "Persona description.",
			handler: ({ env }) => env.character.persona ?? ""
		});
		instance$2.registerMacro("mesExamplesRaw", {
			category: MacroCategory.CHARACTER,
			description: "Unformatted dialogue examples from the character card.",
			returns: "Unformatted dialogue examples.",
			handler: ({ env }) => env.character.mesExamplesRaw ?? ""
		});
		instance$2.registerMacro("mesExamples", {
			category: MacroCategory.CHARACTER,
			description: "The character's dialogue examples, formatted for instruct mode when enabled.",
			returns: "Formatted dialogue examples.",
			handler: ({ env }) => {
				const raw = env.character.mesExamplesRaw ?? "";
				if (!raw) return "";
				const isInstruct = !!power_user?.instruct?.enabled && false;
				const parsed = parseMesExamples(raw, isInstruct);
				if (!Array.isArray(parsed) || parsed.length === 0) return "";
				if (!isInstruct) return parsed.join("");
				const formatted = formatInstructModeExamples(parsed, env.names.user, env.names.char);
				return Array.isArray(formatted) ? formatted.join("") : "";
			}
		});
		instance$2.registerMacro("charDepthPrompt", {
			category: MacroCategory.CHARACTER,
			description: "The character's @ Depth Note.",
			returns: "Character @ Depth Note.",
			handler: ({ env }) => env.character.charDepthPrompt ?? ""
		});
		instance$2.registerMacro("charCreatorNotes", {
			aliases: [{ alias: "creatorNotes" }],
			category: MacroCategory.CHARACTER,
			description: "Creator notes from the character card.",
			returns: "Creator notes.",
			handler: ({ env }) => env.character.creatorNotes ?? ""
		});
		instance$2.registerMacro("charFirstMessage", {
			aliases: [{ alias: "greeting" }],
			category: MacroCategory.CHARACTER,
			unnamedArgs: [{
				name: "index",
				optional: true,
				defaultValue: "0",
				type: MacroValueType.INTEGER,
				description: "0-based index. 0 (default) returns the main greeting, 1 and up return alternate greetings."
			}],
			description: "The character's first message / greeting. Optionally specify an index to access alternate greetings.",
			returns: "Character greeting at the given index, or empty string if out of bounds.",
			exampleUsage: [
				"{{greeting}}",
				"{{greeting::0}}",
				"{{greeting::1}}"
			],
			handler: ({ env, unnamedArgs: [index] }) => {
				const i = Number(index ?? 0);
				if (i === 0) return env.character.firstMessage ?? "";
				const altGreetings = env.character.alternateGreetings;
				if (!Array.isArray(altGreetings)) return "";
				return altGreetings[i - 1] ?? "";
			}
		});
		instance$2.registerMacro("charVersion", {
			aliases: [{
				alias: "version",
				visible: false
			}, {
				alias: "char_version",
				visible: false
			}],
			category: MacroCategory.CHARACTER,
			description: "The character's version number.",
			returns: "Character version number.",
			handler: ({ env }) => env.character.version ?? ""
		});
		instance$2.registerMacro("model", {
			category: MacroCategory.STATE,
			description: "Model name for the currently selected API (Chat Completion or Chat Completion).",
			returns: "Model name.",
			handler: ({ env }) => env.system.model
		});
		instance$2.registerMacro("original", {
			category: MacroCategory.CHARACTER,
			description: "Original message content for {{original}} substitution in in character prompt overrides.",
			returns: "Original message content.",
			handler: ({ env }) => {
				return env.functions.original();
			}
		});
		instance$2.registerMacro("isMobile", {
			category: MacroCategory.STATE,
			description: "\"true\" if currently running in a mobile environment, \"false\" otherwise.",
			returns: "Whether the environment is mobile.",
			returnType: MacroValueType.BOOLEAN,
			handler: () => String(isMobile())
		});
	}
	// cache/upstream/sillytavern/public/scripts/macros/definitions/time-macros.js
	/**
	* Registers time/date related macros and utilities.
	*/
	function registerTimeMacros() {
		instance$2.registerMacro("time", {
			category: MacroCategory.TIME,
			unnamedArgs: [{
				name: "offset",
				optional: true,
				defaultValue: "null",
				type: MacroValueType.STRING,
				sampleValue: "UTC+2",
				description: "UTC offset in the format UTC±(offset)."
			}],
			description: "Current local time, or UTC offset when called as {{time::UTC±(offset)}}",
			returns: "A time string in the format HH:mm.",
			displayOverride: "{{time::[UTC±(offset)]}}",
			exampleUsage: [
				"{{time}}",
				"{{time::UTC+2}}",
				"{{time::UTC-7}}"
			],
			handler: ({ unnamedArgs: [offsetSpec] }) => {
				if (!offsetSpec) return (0, moment$3.default)().format("LT");
				const match = /^UTC([+-]\d+)$/.exec(offsetSpec);
				if (!match) return (0, moment$3.default)().format("LT");
				const offset = Number.parseInt(match[1], 10);
				if (Number.isNaN(offset)) return (0, moment$3.default)().format("LT");
				return (0, moment$3.default)().utc().utcOffset(offset).format("LT");
			}
		});
		instance$2.registerMacro("date", {
			category: MacroCategory.TIME,
			description: "Current local date as a string in the local short format.",
			returns: "Current local date in local short format.",
			handler: () => (0, moment$3.default)().format("LL")
		});
		instance$2.registerMacro("weekday", {
			category: MacroCategory.TIME,
			description: "Current weekday name.",
			returns: "Current weekday name.",
			handler: () => (0, moment$3.default)().format("dddd")
		});
		instance$2.registerMacro("isotime", {
			category: MacroCategory.TIME,
			description: "Current time in HH:mm format.",
			returns: "Current time in HH:mm format.",
			handler: () => (0, moment$3.default)().format("HH:mm")
		});
		instance$2.registerMacro("isodate", {
			category: MacroCategory.TIME,
			description: "Current date in YYYY-MM-DD format.",
			returns: "Current date in YYYY-MM-DD format.",
			handler: () => (0, moment$3.default)().format("YYYY-MM-DD")
		});
		instance$2.registerMacro("datetimeformat", {
			category: MacroCategory.TIME,
			unnamedArgs: [{
				name: "format",
				sampleValue: "YYYY-MM-DD HH:mm:ss",
				description: "Moment.js format string.",
				type: "string"
			}],
			description: "Formats the current date/time using the given moment.js format string.",
			returns: "Formatted date/time string.",
			exampleUsage: ["{{datetimeformat::YYYY-MM-DD HH:mm:ss}}", "{{datetimeformat::LLLL}}"],
			handler: ({ unnamedArgs: [format] }) => (0, moment$3.default)().format(format)
		});
		instance$2.registerMacro("idleDuration", {
			aliases: [{
				alias: "idle_duration",
				visible: false
			}],
			category: MacroCategory.TIME,
			description: "Human-readable duration since the last user message.",
			returns: "Human-readable duration since the last user message.",
			handler: () => getTimeSinceLastMessage()
		});
		instance$2.registerMacro("timeDiff", {
			category: MacroCategory.TIME,
			unnamedArgs: [{
				name: "left",
				sampleValue: "2023-01-01 12:00:00",
				description: "Left time value.",
				type: "string"
			}, {
				name: "right",
				sampleValue: "2023-01-01 15:00:00",
				description: "Right time value.",
				type: "string"
			}],
			description: "Human-readable difference between two times. Order of times does not matter, it will return the absolute difference.",
			returns: "Human-readable difference between two times.",
			displayOverride: "{{timeDiff::left::right}}",
			exampleUsage: ["{{ timeDiff :: 2023-01-01 12:00:00 :: 2023-01-01 15:00:00 }}"],
			handler: ({ unnamedArgs: [left, right] }) => {
				return moment$3.default.duration((0, moment$3.default)(left).diff((0, moment$3.default)(right))).humanize(true);
			}
		});
	}
	function getTimeSinceLastMessage() {
		const now = (0, moment$3.default)();
		if (Array.isArray(chat) && chat.length > 0) {
			let lastMessage;
			let takeNext = false;
			for (let i = chat.length - 1; i >= 0; i--) {
				const message = chat[i];
				if (message.is_system) continue;
				if (message.is_user && takeNext) {
					lastMessage = message;
					break;
				}
				takeNext = true;
			}
			if (lastMessage?.send_date) {
				const lastMessageDate = timestampToMoment(lastMessage.send_date);
				return moment$3.default.duration(now.diff(lastMessageDate)).humanize();
			}
		}
		return "just now";
	}
	// cache/upstream/sillytavern/public/scripts/macros/definitions/chat-macros.js
	/**
	* Registers macros that inspect the current chat log and swipe state
	* (message texts, indices, swipes, and context boundaries).
	*/
	function registerChatMacros() {
		instance$2.registerMacro("lastMessage", {
			category: MacroCategory.CHAT,
			description: "Last message in the chat.",
			returns: "Last message in the chat.",
			handler: () => String(getLastMessage() ?? "")
		});
		instance$2.registerMacro("lastMessageId", {
			category: MacroCategory.CHAT,
			description: "Index of the last message in the chat.",
			returns: "Index of the last message in the chat.",
			returnType: MacroValueType.INTEGER,
			handler: () => String(getLastMessageId() ?? "")
		});
		instance$2.registerMacro("lastUserMessage", {
			category: MacroCategory.CHAT,
			description: "Last user message in the chat.",
			returns: "Last user message in the chat.",
			handler: () => String(getLastUserMessage() ?? "")
		});
		instance$2.registerMacro("lastCharMessage", {
			category: MacroCategory.CHAT,
			description: "Last character/bot message in the chat.",
			returns: "Last character/bot message in the chat.",
			handler: () => String(getLastCharMessage() ?? "")
		});
		instance$2.registerMacro("firstIncludedMessageId", {
			category: MacroCategory.CHAT,
			description: "Index of the first message included in the current context.",
			returns: "Index of the first message included in the context.",
			returnType: MacroValueType.INTEGER,
			handler: () => String(getFirstIncludedMessageId() ?? "")
		});
		instance$2.registerMacro("firstDisplayedMessageId", {
			category: MacroCategory.CHAT,
			description: "Index of the first displayed message in the chat.",
			returns: "Index of the first displayed message in the chat.",
			returnType: MacroValueType.INTEGER,
			handler: () => String(getFirstDisplayedMessageId() ?? "")
		});
		instance$2.registerMacro("lastSwipeId", {
			category: MacroCategory.CHAT,
			description: "1-based index of the last swipe for the last message.",
			returns: "1-based index of the last swipe.",
			returnType: MacroValueType.INTEGER,
			handler: () => String(getLastSwipeId() ?? "")
		});
		instance$2.registerMacro("currentSwipeId", {
			category: MacroCategory.CHAT,
			description: "1-based index of the current swipe.",
			returns: "1-based index of the current swipe.",
			returnType: MacroValueType.INTEGER,
			handler: () => String(getCurrentSwipeId() ?? "")
		});
		instance$2.registerMacro("allChatRange", {
			category: MacroCategory.CHAT,
			description: "Range of all message IDs in the chat (e.g. \"0-10\"). Empty string if the chat is empty.",
			returns: "Range string from 0 to last message ID, or empty string.",
			handler: () => {
				if (!Array.isArray(chat) || chat.length === 0) return "";
				return `0-${chat.length - 1}`;
			}
		});
	}
	function getLastMessageId({ exclude_swipe_in_propress = true, filter = null } = {}) {
		if (!Array.isArray(chat) || chat.length === 0) return null;
		for (let i = chat.length - 1; i >= 0; i--) {
			const message = chat[i];
			if (exclude_swipe_in_propress && message.swipes && message.swipe_id >= message.swipes.length) continue;
			if (!filter || filter(message)) return i;
		}
		return null;
	}
	function getLastMessage() {
		const mid = getLastMessageId();
		return typeof mid === "number" ? chat[mid]?.mes ?? "" : "";
	}
	function getLastUserMessage() {
		const mid = getLastMessageId({ filter: (m) => m.is_user && !m.is_system });
		return typeof mid === "number" ? chat[mid]?.mes ?? "" : "";
	}
	function getLastCharMessage() {
		const mid = getLastMessageId({ filter: (m) => !m.is_user && !m.is_system });
		return typeof mid === "number" ? chat[mid]?.mes ?? "" : "";
	}
	function getFirstIncludedMessageId() {
		const value = chat_metadata.lastInContextMessageId;
		return typeof value === "number" ? value : null;
	}
	function getFirstDisplayedMessageId() {
		const mesElement = document.querySelector("#chat .mes");
		const mesId = Number(mesElement?.getAttribute("mesid"));
		if (!Number.isNaN(mesId) && mesId >= 0) return mesId;
		return null;
	}
	function getLastSwipeId() {
		const mid = getLastMessageId({ exclude_swipe_in_propress: false });
		if (typeof mid !== "number") return null;
		const swipes = chat[mid]?.swipes;
		return Array.isArray(swipes) ? swipes.length : null;
	}
	function getCurrentSwipeId() {
		const mid = getLastMessageId({ exclude_swipe_in_propress: false });
		if (typeof mid !== "number") return null;
		const swipeId = chat[mid]?.swipe_id;
		return typeof swipeId === "number" ? swipeId + 1 : null;
	}
	// \0st-macro-entry
	registerCoreMacros();
	registerVariableMacros();
	registerEnvMacros();
	registerTimeMacros();
	registerChatMacros();
	instance$2.registerMacro("lastGenerationType", {
		category: MacroCategory.STATE,
		handler: () => hostContext.operation ?? "normal"
	});
	Object.defineProperty(exports, "MacroEngine", {
		enumerable: true,
		get: function() {
			return instance;
		}
	});
	return exports;
})({}, chevrotain, seedrandom, droll, moment);

return STModernMacros.MacroEngine;
}
