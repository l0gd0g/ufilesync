'use strict';

const Decorator = require('./index');
const fs = require('fs-extra');

class DecoratorCopy extends Decorator {
	
	constructor(uSync, config) {
		super('copy', uSync, config);
	}
	
	wrapOriginCb(arg, fsMe, task) {
		const decorator = this;
		
		let cbOrigin = arg.pop();// "Вырезаем" колбек котрый должен быть
		
		arg.push(function () {// подменяем на свой
			let argCb = arguments;
			
			// Если при выполнении функции возникла ошибка, то НЕ отправляем на синхронизацию
			if (argCb[0]) {
				decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) error | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
				
				// Вызываем cb который передал программист
				cbOrigin.apply(fsMe, argCb);
			} else {
				decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) fs end | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
				
				if (decorator.functionName === 'copy') {
					fs.lstat(task.path.src, function (err, stats) {
						if (err) return cbOrigin(err);
						
						if (stats.isDirectory()) {
							decorator.generateTaskFromScanDir(task.path.dest, function (err) {
								if (err) return cbOrigin(err);
								
								decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) push | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
								
								// Вызываем cb который передал программист
								cbOrigin.apply(fsMe, argCb);
							});
						} else if (stats.isSymbolicLink()) {
							// Если файл уже существует, то создавать еще один не стоит
							fs.lstat(task.path.dest, function (err, stats) {
								if (! err) {
									// Вызываем cb который передал программист
									return cbOrigin.apply(fsMe, argCb);
								}
								
								fs.readlink(task.path.src, function (err, linkPath) {
									if (err) return cbOrigin(err);
									
									try {
										// Отправляем в очередь на синхронизацию
										decorator.uSync.push(
											decorator.uSync.task('symlink', {
												src : linkPath,
												dest: task.path.dest
											}, 'copy symlink from copy'),
											function (err) {
												decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) push | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
												if (err) {
													cbOrigin(err);
												} else {
													// Вызываем cb который передал программист
													cbOrigin.apply(fsMe, argCb);
												}
											}
										);
									} catch (err) { // Если в случае генерации задачи возникла ошибка, то передаем ее в колбек
										cbOrigin(err);
									}
								});
							});
						} else {
							// Отправляем в очередь на синхронизацию
							decorator.uSync.push(
								task,
								function (err) {
									decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) push | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
									if (err) {
										cbOrigin(err);
									} else {
										// Вызываем cb который передал программист
										cbOrigin.apply(fsMe, argCb);
									}
								}
							);
						}
					});
				} else {
					// Отправляем в очередь на синхронизацию
					decorator.uSync.push(
						task,
						function (err) {
							decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) push | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
							if (err) {
								
								decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) push Error | ${err}ms | ${JSON.stringify(task.path)}`);
								
								
								cbOrigin(err);
							} else {
								// Вызываем cb который передал программист
								cbOrigin.apply(fsMe, argCb);
							}
						}
					);
				}
			}
		});
	}
}

module.exports = DecoratorCopy;
