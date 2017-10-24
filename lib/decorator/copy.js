'use strict';

const Decorator = require('./index');
const fs = require('fs-extra');
const async = require('async');
const _ = require('lodash');


class DecoratorCopy extends Decorator {
	
	constructor(uSync, config) {
		super('copy', uSync, config);
	}
	
	generateTaskFromScanDir(pathDir, isReplace, cb) {
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
										
										decorator.generateTaskFromScanDir(path, isReplace, cb);
									});
									
								} else if (stats.isSymbolicLink()) {
									// Если файл уже существует, то создавать еще один не стоит
									fs.lstat(path, function (err) {
										// Если файл есть и не стоит опция "заменять" - выходим
										if (!err && isReplace === false) {
											// Вызываем cb который передал программист
											return cb();
										}
										
										fs.readlink(path, function (err, linkPath) {
											if (err) return cb(err);
											
											// Отправляем в очередь на синхронизацию
											decorator.uSync.push(
												decorator.uSync.task('unlink', path, 'copy symlink from generateTaskFromScanDir'),
												function (err) {
													if (err) {
														cb(err);
													} else {
														decorator.uSync.push(
															decorator.uSync.task(
																'symlink',
																{
																	src : linkPath,
																	dest: path
																},
																'copy symlink from generateTaskFromScanDir'
															),
															cb
														);
													}
												}
											);
										});
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
	
	wrapOriginCb(arg, fsMe, task) {
		const decorator = this;
		
		let cbOrigin = arg.pop();// "Вырезаем" колбек котрый должен быть
		
		let isReplace = false;
		// Если задали опцию копирования с заменой, то и задачи строим под них
		if (typeof arg[2] === "object" && arg[2].replace) isReplace = true;
		
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
							decorator.generateTaskFromScanDir(task.path.dest, isReplace, function (err) {
								if (err) return cbOrigin(err);
								
								decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) push | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
								
								// Вызываем cb который передал программист
								cbOrigin.apply(fsMe, argCb);
							});
						} else if (stats.isSymbolicLink()) {
							// Если файл уже существует, то создавать еще один не стоит
							fs.lstat(task.path.dest, function (err) {
								// Если файл есть и не стоит опция "заменять" - выходим
								if (!err && isReplace === false) {
									// Вызываем cb который передал программист
									return cbOrigin.apply(fsMe, argCb);
								}
								
								fs.readlink(task.path.src, function (err, linkPath) {
									if (err) return cbOrigin(err);
									
									
									// Отправляем в очередь на синхронизацию
									decorator.uSync.push(
										decorator.uSync.task('unlink', task.path.dest, 'copy symlink from copy'),
										function (err) {
											decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) push unlink | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
											if (err) {
												cbOrigin(err);
											} else {
												decorator.uSync.push(
													decorator.uSync.task(
														'symlink',
														{
															src : linkPath,
															dest: task.path.dest
														},
														'copy symlink from copy'
													),
													function (err) {
														decorator.uSync.debug(task, `${decorator.functionName}(${task.id}) push symlink | ${(new Date().getTime() - task.dateCreate.getTime())}ms | ${JSON.stringify(task.path)}`);
														if (err) {
															cbOrigin(err);
														} else {
															// Вызываем cb который передал программист
															cbOrigin.apply(fsMe, argCb);
														}
													}
												);
											}
										}
									);
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
