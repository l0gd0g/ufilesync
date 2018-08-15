const isStrictMode = (() => {
	const { STRICT_MODE, NODE_ENV, LINT_MODE } = process.env;
	
	if (STRICT_MODE)
		return ['1', 'enable', 'true'].includes(String(STRICT_MODE).toLowerCase());

	if (LINT_MODE)
		return String(LINT_MODE).toLowerCase() === 'strict';
	
	return ['production', 'ci', 'precommit'].includes(String(NODE_ENV).toLowerCase());
})();


const denyInStrictMode = 'warn';

module.exports = {
	'extends': [
		'eslint:recommended', 
	],
	'root': true,
	'env': {
		'node': true,
		'es6': true,
		'mocha': true,
	},
	'globals': {
		'expect'        : true,
		'sinon'         : true,
	},
	'parser': 'babel-eslint',
	'parserOptions': {
		'sourceType': 'module',
	},
	"plugins": [
		"eslint-plugin-no-arrow-this"
	],
	'rules': {
		'no-console': denyInStrictMode,
		'no-debugger': denyInStrictMode,
		'no-cond-assign': [denyInStrictMode, 'except-parens'],
		'no-unreachable': denyInStrictMode,
		'eqeqeq': [denyInStrictMode, 'smart'],
		'no-irregular-whitespace': denyInStrictMode,
		

		
		
		'semi': 'off',
		'indent': 'off',
		'wrap-iife': 'off',
		'no-trailing-spaces': 'off',
		'comma-dangle': 'off',
		'quotes': ['off', 'single'],
		'no-mixed-spaces-and-tabs': 'off',

		
		'no-caller': 'error',
		'no-undef': 'error',
		'valid-typeof': 'error',
		'require-yield': 'error',
		'max-depth': ['error', 8],
		'no-bitwise': [
			'error', {
				'allow': ['~', '|'],
				'int32Hint': false
			}
		],
		'linebreak-style': ['error', 'unix'],
		'no-tabs': 'off',
		
		'max-nested-callbacks': ['error', { 'max': 14 }], 

		
		'no-empty': 'off',
		'no-new': 'off',
		'no-loop-func': 'off',
		'new-cap': 'off',
		'no-use-before-define': ['warn', { 'functions': false, 'variables': false, 'classes': true }], 
		'no-eq-null': 'off', 
		'dot-notation': 'off', 

		
		'no-redeclare': 'warn', 
		'no-extra-boolean-cast': 'warn', 
		'no-extra-semi': 'warn', 
		'no-unused-vars': 'warn', 
		'no-regex-spaces': 'warn', 
		'no-constant-condition': 'warn', 
		'no-unexpected-multiline': 'warn',
		'guard-for-in': 'warn',
		'block-scoped-var': 'warn',
		'complexity': ['warn', { 'max': 25 }], 
		'max-len': ['warn', {
			code: 120, 
			tabWidth: 4,
			ignoreComments: true,
			ignoreTrailingComments: true,
			ignoreUrls: true,
			ignoreStrings: true,
			ignoreTemplateLiterals: true,
			ignoreRegExpLiterals: true,
		}],

		'prefer-const': 'warn',
		'prefer-rest-params': 'warn',
		'prefer-spread': 'warn',
		'prefer-template': 'warn',
		'no-arrow-this/no-arrow-this': [
			'warn', {
				onlyGlobals : true
			}
		]
	},

};

if (process.env.LINT_DEBUG_RULE) {
	module.exports.extends = undefined;
	const { rules } = module.exports;
	Object.keys(rules).forEach(key => { rules[key] = 'off'; });
	rules[process.env.LINT_DEBUG_RULE] = 'error';
}
