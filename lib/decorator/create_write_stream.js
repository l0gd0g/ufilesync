'use strict';

const Decorator = require('./index');
const fs = require('fs-extra');

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
			
			// // Если при создании Task возникла ошибка, то отдаем ее в колбек
			// if (task instanceof decorator.uSync.exceptions.ErrorUSync) {
			// }
			
			if (decorator.isReadyRunFunction(arg, task)) {
				decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) begin | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
				
				return fs.createWriteStream.apply(fsMe, arg).on('finish', () => {
					
					// Вызываем funcCb только если синхронизация готова к использованию
					decorator.uSync.on('ready', () => {
						
						// Отправляем в очередь на синхронизацию без вызова cb
						decorator.push(
							task,
							function (err) {
								if (err) {
									decorator.uSync.fireEventError(err);
								} else {
									decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) end | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
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
