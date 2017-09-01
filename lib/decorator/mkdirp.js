'use strict';

const Decorator = require('./index');
/**
 * Суть заключается в подмене fs
 */
class DecoratorMkdirp extends Decorator{
	
	constructor (uSync, config) {
		super('mkdirp', uSync, config);
	}
	
	wrap (originFunction) {
		const decorator = this;
		
		return function () {
			let fsMe = this;
			let arg = Array.prototype.slice.call(arguments);
			
			if (arg.length > 1) {
				let newArg = [];
				arg.forEach((item, idx) => {
					if (idx === 1) {
						if (typeof item === 'function') {
							newArg[1] = {fs: decorator.uSync.fs};
							newArg.push(item);
						} else if (typeof item === 'object') {
							newArg.push(item);
							newArg[idx].fs = decorator.uSync.fs;
						} else {
							newArg[idx] = {
								fs  : decorator.uSync.fs,
								mode: item
							};
						}
					} else {
						newArg.push(item);
					}
				});
				
				arg = newArg;
			} else {
				arg[1] = {fs: decorator.uSync.fs};
			}
			
			originFunction.apply(fsMe, arg);
		}
	}
}

module.exports = DecoratorMkdirp;
