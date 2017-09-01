'use strict';
const path = require('path');
const Decorator = require('./index');

class DecoratorSymlink extends Decorator {
	
	constructor(uSync, config) {
		super('symlink', uSync, config);
	}
	
	wrap(originFunction) {
		const decorator = this;
		
		return function () {
			let fsMe = this;
			let arg = Array.prototype.slice.call(arguments);
			let task = decorator.generateTaskFromArguments(arg);
			
			// Если при создании Task возникла ошибка, то отдаем ее в колбек
			if (task instanceof decorator.uSync.exceptions.ErrorUSync) {
				let cbOrigin = arg.pop();
				return cbOrigin(task);
			}
			
			if (decorator.isReadyRunFunction(arg, task)) {
				// Подменяем коллбек ЕСЛИ он есть
				if (typeof(arg[arg.length - 1]) === 'function') {
					decorator.wrapOriginCb(arg, fsMe, task);
				} else {
					// Отправляем в очередь на синхронизацию без вызова cb
					decorator.push(
						task,
						function (err) {
							if (err) {
								decorator.uSync.fireEventError(err);
							}
						}
					);
				}
			} else {
				return originFunction.apply(fsMe, arg);
			}
			
			// Вызываем funcCb только если синхронизация готова к использованию
			decorator.uSync.on('ready', () => {
				
				// ВНИМАНИЕ - для всех симлинков насильно вычисляем относительные пути(утвердил с Пашей и Сашей)
				if (decorator.functionName === 'symlink') {
					if (path.isAbsolute(arg[0])) {
						arg[0] = path.relative(path.dirname(arg[1]), arg[0]);
					}
					if (path.isAbsolute(arg[1])) {
						arg[1] = decorator.uSync.getRelativePath(arg[1]);
					}
				}
				
				decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) begin | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
				
				// Запускаем выполнение fs.функции
				originFunction.apply(fsMe, arg);
			});
		}
	}
}

module.exports = DecoratorSymlink;
