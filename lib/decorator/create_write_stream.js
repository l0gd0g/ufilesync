'use strict';

const Decorator = require('./index');

//FIXME доработать на on('ready', ...
class DecoratorMkdirp extends Decorator {
	
	constructor(uSync, config) {
		super('createWriteStream', uSync, config);
	}
	
	wrap(originFunction) {
		const decorator = this;
		
		return function () {
			let fsMe = this;
			let arg = Array.prototype.slice.call(arguments);
			let task = decorator.generateTaskFromArguments(arg);
			
			if (decorator.isReadyRunFunction(arg, task)) {
				return fs.createWriteStream.apply(fsMe, arg).on('finish', () => {
					
					// Вызываем funcCb только если синхронизация готова к использованию
					decorator.uSync.on('ready', () => {
						
						// Отправляем в очередь на синхронизацию без вызова cb
						decorator.push(
							task,
							function (err) {
								if (err) {
									decorator.uSync.fireEventError(err);
								}
							}
						);
						
					});
				});
			} else {
				return fs.createWriteStream.apply(fsMe, arg);
			}
		}
	}
}

module.exports = DecoratorMkdirp;
