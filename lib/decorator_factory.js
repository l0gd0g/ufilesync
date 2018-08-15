'use strict';

const rimraf = require('rimraf');

class DecoratorFactory {

	constructor(uSync, config) {
		this.config = config;
		this.uSync = uSync;

		this.initDecorators();
	}

	initDecorators() {
		this.decorators = {
			mkdirp: require('./decorator/mkdirp'),
			copy: require('./decorator/copy'),
			createWriteStream: require('./decorator/create_write_stream'),
		};

		this.decorator = require('./decorator');
	}

	isSupportedMethod(methodName) {
		return (
			this.config.wrapMethods.includes(methodName) ||
			this.config.supportedMethods.includes(methodName)
		);
	}

	/**
	 * Обернуть функции модуля fs в декораторы
	 * @param fs
	 */
	wrapFs(fs) {
		const me = this;

		// "Копируем" все методы, чтобы их потом переопределить и не тронуть в самом модуле fs
		const fsExt = Object.assign({}, fs);

		// Запрещаем вызов не поддерживаемых функций
		Object.entries(fsExt, it => {
			const [item, functionName] = it;
			if (typeof item === 'function' && !me.isSupportedMethod(functionName)) {
				fsExt[functionName] = () => {
					throw new me.uSync.exceptions.DeprecatedSyncFunctions(functionName);
				};
			}
		});

		// Расширяем функции для отправки в очередь синхронизации
		[...(new Set(me.config.wrapMethods))].forEach(funcName => {
			const decorator = me.decorators[funcName] ?
				new me.decorators[funcName](me.uSync, me.config) :
				new me.decorator(funcName, me.uSync, me.config);

			fsExt[funcName] = decorator.wrap(fsExt[funcName]);
		});

		fsExt.rimraf = new me.decorator('rimraf', me.uSync, me.config).wrap(rimraf);
		fsExt.mkdirs = fsExt.mkdirp;
		return fsExt;
	}

}

module.exports = DecoratorFactory;
