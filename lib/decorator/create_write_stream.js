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

	wrap() {
		const decorator = this;

		return function(...args) {
			const fsMe = this;
			const arg = Array.prototype.slice.call(args);
			const task = decorator.generateTaskFromArguments(arg);

			const debug = (mark, description) => {
				const name = `${decorator.functionName}(${task.id})`;
				const path = JSON.stringify(task.path);
				decorator.uSync.debug(
					task,
					`${name} ${mark} | ${description}ms | ${path}`
				);
			};

			// Если при создании Task возникла ошибка, то отдаем ее в колбек
			if (task instanceof decorator.uSync.exceptions.ErrorUSync) {
				throw decorator.uSync.exceptions.ErrorUSync;
			}

			if (decorator.isReadyRunFunction(arg, task)) {
				debug('begin', task.getTimeElapsed());

				const writeStream = fs.createWriteStream.apply(fsMe, arg);
				const originOn = writeStream.on;

				writeStream.on = function(...args) {
					const stream = this;
					const [key, cb] = args;

					// Если это finish, то выполняем "свою" логику
					if (key !== 'finish') {
						originOn.apply(writeStream, args);
						return;
					}
					// Если не был объявлен наш обработчик, то добавляем его
					if (!stream.__onFinish) {
						stream.__onFinish = [];
						task.setTimeStartDebug('fs');

						originOn.apply(writeStream, ['finish', () => {
							// Вызываем funcCb только если синхронизация готова к использованию
							decorator.uSync.on('ready', () => {

								// Отправляем в очередь на синхронизацию без вызова cb
								decorator.push(
									task,
									err => {
										if (err) {
											decorator.uSync.fireEventError(err);
										} else {
											debug('end', task.getTimeElapsed());
										}

										// Вызываем переданные программистом функции
										stream.__onFinish.forEach(cb => {
											cb();
										});
									}
								);

							});
						}]);
					}

					stream.__onFinish.push(cb);

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
