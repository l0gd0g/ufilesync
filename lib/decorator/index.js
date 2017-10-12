'use strict';
/**
 * Весь велосипед заключается в том, чтобы переопределить колбек(если его передали)
 * и после того как выполнится fs.функция(иначе файла может не быть и нечего отправлять будет)
 * отправить задачу в очередь на синхронизацию
 * и если отправлка прошла успешно, только после этого вызвать колбек переданный для fs.функции
 */

const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const async = require('async');

class Decorator {
	
	constructor(functionName, uSync, config) {
		this.functionName = functionName;
		this.config = config;
		this.uSync = uSync;
	}
	
	getRelativePath(pathToFile) {
		if (path.isAbsolute(pathToFile)) {
			return path.relative(this.config.baseDir, pathToFile);
		} else {
			return pathToFile;
		}
	}
	
	/**
	 * Получить или сгенерировать нужную "задачу" для отправки в очередь
	 * @param me
	 * @param arg - аргументы функции в которую возможно была передана задача на синхронизацию
	 * @returns {Task || Skip}
	 */
	generateTaskFromArguments(arg) {
		const decorator = this;
		/**
		 * Для возможности управления отправкой сообщения в очередь, первым параметром может прийти объект Task или SkipTask
		 * Иначе создаем Task сообщение из того, что имеем
		 * @type {Task}
		 */
		
		
		// Если первый аргумент это объект SkipTask или Task
		if (arg[0] instanceof decorator.uSync.tasks.Task) {
			return arg.shift();
		} else {
			
			// Путь к файлу
			let pathToFiles = '';
			
			switch (decorator.functionName) {
				case 'copy':
				case 'move':
				case 'copyFile':
				case 'rename':
					pathToFiles = {src: decorator.getRelativePath(arg[0]), dest: decorator.getRelativePath(arg[1])};
					break;
				case 'symlink':
					pathToFiles = {src: arg[0], dest: arg[1]};
					break;
				default:
					pathToFiles = decorator.getRelativePath(arg[0]);
					break;
			}
			
			// let queueName = decorator.uSync.selectQueuePostfix(pathToFiles.dest || pathToFiles);
			//
			// if (queueName.length === 0) {
			// 	decorator.uSync.debug(`Not give queueName for path: ${pathToFiles.dest || pathToFiles}`);
			// 	return decorator.uSync.taskSkip();
			// } else {
			// 	return decorator.uSync.task(decorator.functionName, pathToFiles, queueName);
			// }
			
			return decorator.uSync.task(decorator.functionName, pathToFiles);
		}
	}
	
	generateTaskFromScanDir(pathDir, cb) {
		let decorator = this;
		fs.readdir(pathDir, (err, listItems) => {
			if (err) {
				return cb(err);
			} else {
				async.series(
					_.map(listItems, (dir) => {
						return (cb) => {
							let path = pathDir + '/' + dir;
							fs.lstat(path, function (err, stats) {
								if (err) return cb(err);
								
								if (stats.isDirectory()) {
									// Отправляем в очередь на синхронизацию
									decorator.uSync.push(decorator.uSync.task('mkdirp', path, 'copy recursive'), function (err) {
										if (err) return cb(err);
										
										decorator.generateTaskFromScanDir(path, cb);
									});
									
								} else if (stats.isSymbolicLink()) {
									fs.readlink(path, function (err, linkPath) {
										if (err) return cb(err);
										
										// Отправляем в очередь на синхронизацию
										decorator.uSync.push(decorator.uSync.task('symlink', {
											src : linkPath,
											dest: path
										}, 'copy symlink'), cb);
									});
								} else {
									// Отправляем в очередь на синхронизацию
									decorator.uSync.push(decorator.uSync.task('writeFile', path, 'copy recursive'), cb);
								}
							});
						}
					}),
					cb
				);
			}
		});
	}
	
	/**
	 * Готов ли декоратор отправлять в очередь на синхронизацию
	 * @param arg
	 * @param task
	 * @return {boolean}
	 */
	isReadyRunFunction(arg, task) {
		const decorator = this;
		
		// Если синхронизация остановлена, то ничего не отправляем в очередь
		if (decorator.config.isRunSync === false) {
			return false;
		}
		
		// Если получили задачу для пропуска синхронизации, то сразу вызываем колбек функции
		if (task instanceof decorator.uSync.tasks.Skip) {
			decorator.uSync.debug(task, `${decorator.functionName} | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(arg[0])} - skip synchronise`);
			return false;
		}
		
		return true;
	}
	
	wrapOriginCb(arg, fsMe, task) {
		const decorator = this;
		let cbOrigin = arg.pop();// "Вырезаем" колбек котрый должен быть
		
		arg.push(function () {// подменяем на свой
			let argCb = arguments;
			
			// Если при выполнении функции возникла ошибка, то НЕ отправляем на синхронизацию
			if (argCb[0]) {
				decorator.uSync.debug(task, `${decorator.functionName}(${task.id})  error | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)} | ${argCb[0]}`);
				
				// Вызываем cb который передал программист
				cbOrigin.apply(fsMe, argCb);
			} else {
				decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) fs end | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
				
				// Отправляем в очередь на синхронизацию
				decorator.uSync.push(task, err => {
					if (err) {
						cbOrigin(err);
					} else {
						// Вызываем cb который передал программист
						cbOrigin.apply(fsMe, argCb);
					}
				});
			}
		});
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
			
			// Если готовы
			if (decorator.isReadyRunFunction(arg, task)) {
				// Подменяем коллбек ЕСЛИ он есть
				if (typeof(arg[arg.length - 1]) === 'function') {
					decorator.wrapOriginCb(arg, fsMe, task);
				} else {
					// Обработка асинхронных вызовов(по идее таких не должно быть)
					decorator.uSync.push(task, (err) => {
						if (err) {
							decorator.uSync.fireEventError(err);
						}
					});
				}
			} else {
				return originFunction.apply(fsMe, arg);
			}
			
			// Вызываем funcCb только если синхронизация готова к использованию
			decorator.uSync.on('ready', () => {
				
				decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) begin | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
				
				// Запускаем выполнение fs.функции
				originFunction.apply(fsMe, arg);
			});
		}
	}
	
	push(task, cb) {
		this.uSync.push(task, cb);
	}
	
}

module.exports = Decorator;
