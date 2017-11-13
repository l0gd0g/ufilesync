'use strict';

const Decorator = require('./index');
const fs = require('fs-extra');


// class uCreateWriteStream {
//
// 	static on(key, cb) {
// 		// ['close', 'drain', 'error', 'finish', 'pipe', 'unpipe']
// 	}
//
// }


class DecoratorCreateWriteStream extends Decorator {
	
	constructor(uSync, config) {
		super('createWriteStream', uSync, config);
	}
	
	wrap(originFunction) {
		const decorator = this;
		
		return function () {
			let fsMe = this;
			let arg = Array.prototype.slice.call(arguments);
			let task = decorator.generateTaskFromArguments(arg);
			
			// Если при создании Task возникла ошибка, то отдаем ее в колбек
			if (task instanceof decorator.uSync.exceptions.ErrorUSync) {
				throw decorator.uSync.exceptions.ErrorUSync;
			}
			
			if (decorator.isReadyRunFunction(arg, task)) {
				decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) begin | ${task.getTimeElapsed()}ms | ${JSON.stringify(task.path)}`);
				
				let writeStream = fs.createWriteStream.apply(fsMe, arg);
				let originOn = writeStream.on;
				
				writeStream.on = function (key, cb) {
					
					// Если это finish, то выполняем "свою" логику
					if (key === 'finish') {
						// Если не был объявлен наш обработчик, то добавляем его
						if (!this.__onFinish) {
							this.__onFinish = [];
							task.setTimeStartDebug('fs');
							
							originOn.apply(writeStream, ['finish', function() {
								// Вызываем funcCb только если синхронизация готова к использованию
								decorator.uSync.on('ready', () => {
									
									// Отправляем в очередь на синхронизацию без вызова cb
									decorator.push(
										task,
										err => {
											if (err) {
												decorator.uSync.fireEventError(err);
											} else {
												decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) end | ${task.getTimeElapsed()}ms | ${JSON.stringify(task.path)}`);
											}
											
											// Вызываем переданные программистом функции
											this.__onFinish.forEach(cb => {
												cb();
											});
										}
									);
									
								});
							}]);
						}
						
						this.__onFinish.push(cb);
					} else {
						originOn.apply(writeStream, arguments);
					}
					
					return writeStream;
				};
				
				return writeStream;
			} else {
				return fs.createWriteStream.apply(fsMe, arg);
			}
		}
	}
}

module.exports = DecoratorCreateWriteStream;
