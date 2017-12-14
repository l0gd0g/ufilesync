'use strict';
/**
 * Created by Maxim on 02.09.2016.
 */

const path = require('path');
const fs = require('fs-extra');
const formidable = require('formidable');
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
		console.log(message);
	}
	
	httpServerInit() {
		const me = this;
		
		http.createServer((req, res) => {
			if (req.method === 'POST') {
				switch (req.url) {
					case '/upload':
						// TODO подумать над загрузкой файла сразу на свое место
						let form = new formidable.IncomingForm();
						
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
							
							me.debug('Receive stack length:' + stackTasks.length);
							
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
	
	
	process(task, files, cb) {
		var me = this;
		
		switch (task.command) {
			case 'mkdirp':
			case 'mkdirs':
			case 'mkdir':
				fs.mkdirs(path.join(me.config.baseDir, task.path.src), function (err) {
					if (err) return cb(err);
					
					me.utimes(task.path.src, task.stats.atime, task.stats.mtime, cb);
				});
				break;
			case 'write':
			case 'writeFile':
			case 'createWriteStream':
				if (files[task.id]) {
					fs.mkdirs(path.dirname(path.join(me.config.baseDir, task.path.src)), (err) => {
						if (err) return cb(err);
						
						// Перемещаем файл из временной директории в нужное место
						fs.move(files[task.id].path, path.join(me.config.baseDir, task.path.src), {clobber: true}, function (err) {
							if (err) return cb(err);
							
							me.utimes(path.join(me.config.baseDir, task.path.src), task.stats.atime, task.stats.mtime, cb);
						});
					});
				} else {
					cb(new exceptions.ErrorReceiverProcess(`Not exist file for path "${path.join(me.config.baseDir, task.path.src)}"`, task));
				}
				break;
			case 'rmdir':
				fs.rmdir(path.join(me.config.baseDir, task.path.src), cb);
				break;
			case 'unlink':
			case 'remove':
				if (me.config.isUseRemoveFiles) {
					fs.unlink(path.join(me.config.baseDir, task.path.src), cb);
				} else {
					cb();
					//TODO генерировать ошибку и перехватывать ее выше, чтобы в лог выдавать информацию о том, что задачу пропускаем
				}
				break;
			case 'rimraf':
				if (me.config.isUseRemoveFiles) {
					rimraf(path.join(me.config.baseDir, task.path.src), cb);
				} else {
					cb();
					//TODO генерировать ошибку и перехватывать ее выше, чтобы в лог выдавать информацию о том, что задачу пропускаем
					
				}
				break;
			case 'copyFile':
			case 'copy':
				fs.mkdirs(path.dirname(path.join(me.config.baseDir, task.path.dest)), (err) => {
					if (err) return cb(err);
					
					if (files[task.id]) {
						fs.mkdirs(path.dirname(path.join(me.config.baseDir, task.path.dest)), (err) => {
							if (err) return cb(err);
							
							// Перемещаем файл из временной директории в нужное место
							fs.move(files[task.id].path, path.join(me.config.baseDir, task.path.dest), {clobber: true}, function (err) {
								if (err) return cb(err);
								
								me.utimes(path.join(me.config.baseDir, task.path.dest), task.stats.atime, task.stats.mtime, cb);
							});
						});
					} else {
						cb(new exceptions.ErrorReceiverProcess(`Not exist file for path ${path.join(me.config.baseDir, task.path.src)}`, task));
					}
				});
				break;
			case 'move':
			case 'rename':
				fs.mkdirs(path.dirname(path.join(me.config.baseDir, task.path.dest)), (err) => {
					if (err) return cb(err);
					
					if (files[task.id]) {
						fs.mkdirs(path.dirname(path.join(me.config.baseDir, task.path.dest)), (err) => {
							if (err) return cb(err);
							
							// Перемещаем файл из временной директории в нужное место
							fs.move(files[task.id].path, path.join(me.config.baseDir, task.path.dest), {clobber: true}, function (err) {
								if (err) return cb(err);
								
								me.utimes(path.join(me.config.baseDir, task.path.dest), task.stats.atime, task.stats.mtime, function (err) {
									if (err) return cb(err);
									
									// Так как это команда перемещения файла, то исходящий файл необходимо удалить
									fs.unlink(task.path.src, cb);
								});
								
							});
						});
					} else {
						cb(new exceptions.ErrorReceiverProcess(`Not exist file for path ${path.join(me.config.baseDir, task.path.src)}`, task));
					}
				});
				break;
			case 'symlink':
				fs.mkdirs(path.dirname(path.join(me.config.baseDir, task.path.dest)), (err) => {
					if (err) return cb(err);
					
					fs.symlink(path.join(me.config.baseDir, task.path.src), path.join(me.config.baseDir, task.path.dest), function (err) {
						if (err) return cb(err);
						
						me.utimes(path.join(me.config.baseDir, task.path.dest), task.stats.atime, task.stats.mtime, cb);
					});
				});
				break;
			default:
				cb(new exceptions.ErrorReceiverProcess(`"${task.command}" - command not found, for path: ${path.join(me.config.baseDir, task.path.src)}`, task));
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
			cb(new exceptions.ErrorTransmitter(cbName + ' - not exist this action'));
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
			console.error(err);
		} else {
			me.onAction.error.forEach(cb => {
				cb(err);
			});
		}
	}
}

module.exports = Receiver;
