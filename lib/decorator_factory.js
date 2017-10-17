'use strict';

const _ = require('lodash');
const rimraf = require('rimraf');


class DecoratorFactory {
	
	constructor(uSync, config) {
		this.config = config;
		this.uSync = uSync;
		
		this.initDecorators();
	}
	
	initDecorators() {
		this.decorators = {
			mkdirp           : require('./decorator/mkdirp'),
			copy             : require('./decorator/copy'),
			createWriteStream: require('./decorator/create_write_stream'),
		};
		
		this.decorator = require('./decorator');
	}
	
	isSupportedMethod(methodName) {
		if (
			this.config.wrapMethods.indexOf(methodName) !== -1 ||
			this.config.supportedMethods.indexOf(methodName) !== -1
		) {
			return true;
		} else {
			return false;
		}
	}
	
	/**
	 * Обернуть функции модуля fs в декораторы
	 * @param fs
	 */
	wrapFs(fs) {
		const me = this;
		
		// "Копируем" все методы, чтобы их потом переопределить и не тронуть в самом модуле fs
		let fsExt = _.extend({}, fs);
		
		// Запрещаем вызов не поддерживаемых функций
		_.each(fsExt, function (item, functionName) {
			if (typeof item === 'function') {
				if (me.isSupportedMethod(functionName) === false) {
					fsExt[functionName] = function () {
						throw new me.uSync.exceptions.DeprecatedSyncFunctions(functionName);
					};
				}
			}
		});
		
		// Расширяем функции для отправки в очередь синхронизации
		_.each(_.uniq(me.config.wrapMethods), funcName => {
			if (me.decorators[funcName]) {
				fsExt[funcName] = new me.decorators[funcName](me.uSync, me.config).wrap(fsExt[funcName]);
			} else {
				fsExt[funcName] = new me.decorator(funcName, me.uSync, me.config).wrap(fsExt[funcName]);
			}
		});
		
		fsExt.rimraf = new me.decorator('rimraf', me.uSync, me.config).wrap(rimraf);
		fsExt.mkdirs = fsExt.mkdirp;
		return fsExt;
	}
	
}

module.exports = DecoratorFactory;
