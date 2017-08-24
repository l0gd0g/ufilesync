#!/usr/bin/node.sh
'use strict';
/**
 * Created by Maxim on 02.09.2016.
 */

const path = require('path');
const bunyan = require('bunyan');
const fs = require('fs-extra');
const formidable = require('formidable');
const rimraf = require('rimraf');
const fstime = require('fstime');
const regExpFindPath = new RegExp('"src".*"dest"');
const http = require('http');
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
		
		this.httpServerInit();
	}
	
	debug(message){
		if (this.config.isRunDebugMode) {
			console.log(message);
		}
	}
	
	httpServerInit() {
		const me = this;
		// TODO в дальнейшем заложиться на обработку списка файлов
		
		http.createServer((req, res) => {
			if (req.method === 'POST') {
				let form = new formidable.IncomingForm();
				
				form.maxFieldsSize = me.config.receiver.maxFieldsSize;
				form.uploadDir = me.config.receiver.uploadDir;
				
				form.parse(req, function (err, fields, files) {
					if (err) {
						err.fields = fields;
						return me.responseError(err, res);
					}
					
					try {
						me.fireEventTask(fields);
						
						if (fields.stats) {
							fields.stats = JSON.parse(fields.stats);
						}
						
						if (fields.path && regExpFindPath.test(fields.path)) fields.path = JSON.parse(fields.path);
						
						me.debug(fields);
						
						me.process(fields, files, (err) => {
							if (err) {
								err.fields = fields;
								return me.responseError(err, res);
							}
							
							me.fireEventProcessComplete(fields);
							me.responseSuccess(res);
						});
						
					} catch (err) {
						err.fields = fields;
						me.responseError(err, res);
					}
				});
			} else {
				me.responseNoFound(req, res);
			}
		}).listen(me.config.fileSync.port, () => {
			me.debug(`Receiver ready and listen on port: ${me.config.fileSync.port}`);
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
			fields: JSON.stringify(err.fields)
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
	
	
	process(fields, files, cb) {
		var me = this;
		
		switch (fields.command) {
			case 'mkdirp':
			case 'mkdirs':
			case 'mkdir':
				fs.mkdirs(fields.path, function (err) {
					if (err) return cb(err);
					
					me.utimes(fields.path, fields.stats.atime, fields.stats.mtime, cb);
				});
				break;
			case 'write':
			case 'writeFile':
			case 'createWriteStream':
				if (files.file) {
					fs.mkdirs(path.dirname(fields.path), (err) => {
						if (err) return cb(err);
						
						// Перемещаем файл из временной директории в нужное место
						fs.move(files.file.path, fields.path, {clobber: true}, function (err) {
							if (err) return cb(err);
							
							me.utimes(fields.path, fields.stats.atime, fields.stats.mtime, cb);
						});
					});
				} else {
					cb(new exceptions.ErrorReceiverProcess(`Not exist file for path "${fields.path}"`, fields));
				}
				break;
			case 'rmdir':
				fs.rmdir(fields.path, cb);
				break;
			case 'unlink':
				fs.unlink(fields.path, cb);
				break;
			case 'rimraf':
				rimraf(fields.path, cb);
				break;
			case 'copyFile':
			case 'copy':
				fs.mkdirs(path.dirname(fields.path.dest), (err) => {
					if (err) return cb(err);
					
					if (files.file) {
						fs.mkdirs(path.dirname(fields.path.dest), (err) => {
							if (err) return cb(err);
							
							// Перемещаем файл из временной директории в нужное место
							fs.move(files.file.path, fields.path.dest, {clobber: true}, function (err) {
								if (err) return cb(err);
								
								me.utimes(fields.path.dest, fields.stats.atime, fields.stats.mtime, cb);
							});
						});
					} else {
						cb(new exceptions.ErrorReceiverProcess(`Not exist file for path ${fields.path}`, fields));
					}
				});
				break;
			case 'move':
			case 'rename':
				fs.mkdirs(path.dirname(fields.path.dest), (err) => {
					if (err) return cb(err);
					
					if (files.file) {
						fs.mkdirs(path.dirname(fields.path.dest), (err) => {
							if (err) return cb(err);
							
							// Перемещаем файл из временной директории в нужное место
							fs.move(files.file.path, fields.path.dest, {clobber: true}, function (err) {
								if (err) return cb(err);
								
								// me.utimes(fields.path.dest, fields.stats.atime_sec, fields.stats.atime_nsec, fields.stats.mtime_sec, fields.stats.mtime_nsec, function (err) {
								me.utimes(fields.path.dest, fields.stats.atime, fields.stats.mtime, function (err) {
									if (err) return cb(err);
									
									// Так как это команда перемещения файла, то исходящий файл необходимо удалить
									fs.unlink(fields.path.src, cb);
								});
								
							});
						});
					} else {
						cb(new exceptions.ErrorReceiverProcess(`Not exist file for path ${fields.path}`, fields));
					}
				});
				break;
			case 'symlink':
				fs.mkdirs(path.dirname(fields.path.dest), (err) => {
					if (err) return cb(err);
					
					fs.symlink(fields.path.src, fields.path.dest, function (err) {
						if (err) return cb(err);
						
						me.utimes(fields.path.dest, fields.stats.atime, fields.stats.mtime, cb);
					});
				});
				break;
			default:
				cb(new exceptions.ErrorReceiverProcess(`"${fields.command}" - command not found, for path: ${fields.path}`, fields));
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
