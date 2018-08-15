'use strict';
/**
 * Created by Maxim on 02.09.2016.
 */

const path = require('path');
const fs = require('fs-extra');
const IncomingForm = require('formidable').IncomingForm;
const rimraf = require('rimraf');
const fstime = require('fstime');
const http = require('http');
const async = require('async');
const exceptions = require('../exceptions');

class Receiver {
	
	constructor(config) {
		this.config = config;
		this.onAction = {
			error       : [],
			ready       : [],
			task        : [],
			taskComplete: []
		};
		
		this.config.baseDir = this.config.baseDir || '.';
		
		fs.access(this.config.uploadDir, fs.R_OK, err => {
			if (err) {
				this.fireEventError(err);
			} else {
				this.httpServerInit();
			}
		});
	}
	
	debug(message) {
		// eslint-disable-next-line
		console.log(message);
	}
	
	httpServerInit() {
		const me = this;
		
		http.createServer((req, res) => {
			if (req.method === 'POST') {
				switch (req.url) {
					case '/upload':
						// TODO подумать над загрузкой файла сразу на свое место
						var form = new IncomingForm();
						
						form.maxFieldsSize = me.config.maxFieldsSize;
						form.uploadDir = me.config.uploadDir;
						
						form.parse(req, function (err, fields, files) {
							if (err) {
								err.fields = fields;
								return me.responseError(err, res);
							}
							
							let stackTasks;
							
							try {
								stackTasks = JSON.parse(fields.tasks);
							} catch (err) {
								err.fields = fields;
								return me.responseError(err, res);
							}
							
							me.debug(`Receive stack length:${stackTasks.length}`);
							
							async.eachSeries(
								stackTasks,
								(task, cb) => {
									me.fireEventTask(task);
									
									me.debug(task);
									
									me.process(task, files, (err) => {
										if (err) {
											err.fields = task;
											return cb(err);
										}
										
										me.fireEventProcessComplete(task);
										cb();
									});
									
								},
								err => {
									if (err) {
										me.responseError(err, res);
									} else {
										me.responseSuccess(res);
									}
								}
							);
							
							
						});
						break;
					case '/test' :
						me.responseSuccess(res);
						break;
					default :
						me.responseNoFound(req, res);
				}
			} else {
				me.responseNoFound(req, res);
			}
		}).listen(me.config.port, () => {
			me.debug(`Receiver ready and listen on port: ${me.config.port}`);
			me.fireEventReady();
		});
	}
	
	
	utimes(path, atime, mtime, cb) {
		try {
			fstime.utimesSync(path, atime, mtime);
			cb();
		} catch (err) {
			cb(err);
		}
	}
	
	
	responseError(err, res) {
		this.fireEventError(err);
		
		err.message = JSON.stringify({
			messageError: err.message,
			fields      : JSON.stringify(err.fields)
		});
		
		res.writeHead(503, {'content-type': 'text/json'});
		res.end(`{errors: [ error: {message: "${err.toString()}", status: 503 }]}`);
	}
	
	
	responseSuccess(res) {
		res.writeHead(200, {'content-type': 'text/json'});
		res.end('');
	}
	
	
	responseNoFound(req, res) {
		res.writeHead(404, {'content-type': 'text/json'});
		res.end(`{errors: [ error: {message: "${req.url} - no found", status: 404 }]}`);
	}
	
	srcPath (task) {
		const me = this;
		return path.join(me.config.baseDir, task.path.src);
	}
	
	destPath (task) {
		const me = this;
		return me.destPath(task);
	}
	

	process(task, files, cb) {
		const me = this;
		switch (task.command) {
			case 'mkdirp':
			case 'mkdirs':
			case 'mkdir':
				fs.mkdirs(me.srcPath(task), function (err) {
					if (err) return cb(err);
					
					me.utimes(task.path.src, task.stats.atime, task.stats.mtime, cb);
				});
				break;
			case 'write':
			case 'writeFile':
			case 'createWriteStream':
				if (files[task.id]) {
					fs.mkdirs(path.dirname(me.srcPath(task)), (err) => {
						if (err) return cb(err);
						
						// Перемещаем файл из временной директории в нужное место
						fs.move(files[task.id].path, me.srcPath(task), {clobber: true}, function (err) {
							if (err) return cb(err);
							
							me.utimes(me.srcPath(task), task.stats.atime, task.stats.mtime, cb);
						});
					});
				} else {
					cb(new exceptions.ErrorReceiverProcess(`Not exist file for path "${me.srcPath(task)}"`, task));
				}
				break;
			case 'rmdir':
				fs.rmdir(me.srcPath(task), cb);
				break;
			case 'unlink':
			case 'remove':
				if (me.config.isUseRemoveFiles) {
					fs.unlink(me.srcPath(task), cb);
				} else {
					cb();
					//TODO генерировать ошибку и перехватывать ее выше, чтобы в лог выдавать информацию о том, что задачу пропускаем
				}
				break;
			case 'rimraf':
				if (me.config.isUseRemoveFiles) {
					rimraf(me.srcPath(task), cb);
				} else {
					cb();
					//TODO генерировать ошибку и перехватывать ее выше, чтобы в лог выдавать информацию о том, что задачу пропускаем
					
				}
				break;
			case 'copyFile':
			case 'copy':
				fs.mkdirs(path.dirname(me.destPath(task)), (err) => {
					if (err) return cb(err);
					
					if (files[task.id]) {
						fs.mkdirs(path.dirname(me.destPath(task)), (err) => {
							if (err) return cb(err);
							
							// Перемещаем файл из временной директории в нужное место
							fs.move(files[task.id].path, me.destPath(task), {clobber: true}, function (err) {
								if (err) return cb(err);
								
								me.utimes(me.destPath(task), task.stats.atime, task.stats.mtime, cb);
							});
						});
					} else {
						cb(new exceptions.ErrorReceiverProcess(`Not exist file for path ${me.srcPath(task)}`, task));
					}
				});
				break;
			case 'move':
			case 'rename':
				fs.mkdirs(path.dirname(me.destPath(task)), (err) => {
					if (err) return cb(err);
					
					if (files[task.id]) {
						fs.mkdirs(path.dirname(me.destPath(task)), (err) => {
							if (err) return cb(err);
							
							// Перемещаем файл из временной директории в нужное место
							fs.move(files[task.id].path, me.destPath(task), {clobber: true}, function (err) {
								if (err) return cb(err);
								
								me.utimes(me.destPath(task), task.stats.atime, task.stats.mtime, function (err) {
									if (err) return cb(err);
									
									// Так как это команда перемещения файла, то исходящий файл необходимо удалить
									fs.unlink(task.path.src, cb);
								});
								
							});
						});
					} else {
						cb(new exceptions.ErrorReceiverProcess(`Not exist file for path ${me.srcPath(task)}`, task));
					}
				});
				break;
			case 'symlink':
				fs.mkdirs(path.dirname(me.destPath(task)), (err) => {
					if (err) return cb(err);
					
					fs.symlink(me.srcPath(task), me.destPath(task), function (err) {
						if (err) return cb(err);
						
						me.utimes(me.destPath(task), task.stats.atime, task.stats.mtime, cb);
					});
				});
				break;
			default:
				cb(new exceptions.ErrorReceiverProcess(`"${task.command}" - command not found, for path: ${me.srcPath(task)}`, task));
		}
	}
	
	
	/**
	 * Обработчик событий
	 * @param cbName
	 * @param cb
	 */
	on(cbName, cb) {
		const me = this;
		if (me.onAction[cbName]) {
			if (cbName === 'connected' && me.isConnected) {
				cb();
			} else {
				me.onAction[cbName].push(cb);
			}
		} else {
			cb(new exceptions.ErrorTransmitter(`${cbName} - not exist this action`));
		}
	}
	
	/**
	 * Запуск события, когда задача выполненна
	 */
	fireEventProcessComplete(task) {
		const me = this;
		me.onAction.taskComplete.forEach(cb => {
			cb(task);
		});
	}
	
	fireEventReady() {
		const me = this;
		me.onAction.ready.forEach(cb => {
			cb();
		});
	}
	
	fireEventTask(task) {
		const me = this;
		me.onAction.task.forEach(cb => {
			cb(task);
		});
	}
	
	
	/**
	 * Запуск событий, когда приходят ошибки
	 */
	fireEventError(err) {
		const me = this;
		if (me.onAction.error.length === 0) {
			me.debug(err);
		} else {
			me.onAction.error.forEach(cb => {
				cb(err);
			});
		}
	}
}

module.exports = Receiver;
