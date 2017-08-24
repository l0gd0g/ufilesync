#!/usr/bin/node.sh
'use strict';
/**
 * Created by Maxim on 02.09.2016.
 */

const config = require('conf.js');
const path = require('path');
const bunyan = require('bunyan');
const fs = require('fs-extra');
const formidable = require('formidable');
const rimraf = require('rimraf');
const fstime = require('fstime');//FIXME вынести этот модуль в npm
const regExpFindPath = new RegExp('"src".*"dest"');

const log = bunyan.createLogger({
	name: 'usync_receiver',
	streams: [
		{
			level: 'info',
			path: path.join(config.path.baseDirLog, 'usync_receiver_info.log')
		},
		{
			level: 'error',
			path: path.join(config.path.baseDirLog, 'usync_receiver_error.log')
		}
	]
});


class Receiver {
	
	constructor(config) {
		this.config = config;
		this.httpServerInit();
	}
	
	
	httpServerInit() {
		var me = this;
		// TODO в дальнейшем заложиться на обработку списка файлов
		var http = require('http');
		
		console.log('Server ready');
		
		http.createServer((req, res) => {
			if (req.method == 'POST') {
				var form = new formidable.IncomingForm();
				
				form.maxFieldsSize = me.config.uSync.receiver.maxFieldsSize;
				form.uploadDir = me.config.uSync.receiver.uploadDir;
				
				form.parse(req, function (err, fields, files) {
					if (err) return me.responseError(err, res);
					
					try {
						
						if (fields.stats) {
							fields.stats = JSON.parse(fields.stats);
						}
						
						// if (fields.path && -1 != fields.path.indexOf('src')) fields.path = JSON.parse(fields.path);
						if (fields.path && regExpFindPath.test(fields.path)) fields.path = JSON.parse(fields.path);
						
						//log.info(`${fields.command}: ${fields.path.dest || fields.path}`);
						log.info('exec command',{
							command: fields.command,
							path: (fields.path.dest)? `src: ${fields.path.src}, dest: ${fields.path.dest}` : fields.path
						});
						
						me.process(fields, files, (err) => {
							if (err) return me.responseError(err, res);
							
							me.responseSuccess(res);
						});
						
					} catch (err) {
						err.message = JSON.stringify({
							messageError: err.message,
							fields: JSON.stringify(fields)
						});
						
						me.responseError(err, res);
					}
				});
			} else {
				me.responseNoFound(req, res);
			}
		}).listen(me.config.uSync.fileSync.port);
	}
	
	
	// utimes(path, atime_sec, atime_nsec, mtime_sec, mtime_nsec, cb) {
	// 	fstime.utimesSync(path, atime_sec, atime_nsec, mtime_sec, mtime_nsec);
	// 	cb();
	// }
	
	utimes(path, atime, mtime, cb) {
		try {
			fstime.utimesSync(path, atime, mtime);
			cb();
		} catch (err) {
			cb(err);
		}
	}
	
	
	responseError(err, res) {
		log.error(err);
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
					
					fields.stats = me.convertOldStats(fields.stats);
					// me.utimes(fields.path, fields.stats.atime_sec, fields.stats.atime_nsec, fields.stats.mtime_sec, fields.stats.mtime_nsec, cb);
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
							
							fields.stats = me.convertOldStats(fields.stats);
							// me.utimes(fields.path, fields.stats.atime_sec, fields.stats.atime_nsec, fields.stats.mtime_sec, fields.stats.mtime_nsec, cb);
							me.utimes(fields.path, fields.stats.atime, fields.stats.mtime, cb);
						});
					});
				} else {
					log.info('Not exist file for path', {
						path: fields.path
					});
					cb();
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
					
					// fs.copy(fields.path.src, fields.path.dest, function (err) {
					// 	if (err) return cb(err);
					//	
					// 	me.utimes(fields.path.dest, fields.stats.atime_sec, fields.stats.atime_nsec, fields.stats.mtime_sec, fields.stats.mtime_nsec, cb);
					// });
					
					if (files.file) {
						fs.mkdirs(path.dirname(fields.path.dest), (err) => {
							if (err) return cb(err);
							
							// Перемещаем файл из временной директории в нужное место
							fs.move(files.file.path, fields.path.dest, {clobber: true}, function (err) {
								if (err) return cb(err);
								
								fields.stats = me.convertOldStats(fields.stats);
								// me.utimes(fields.path.dest, fields.stats.atime_sec, fields.stats.atime_nsec, fields.stats.mtime_sec, fields.stats.mtime_nsec, cb);
								me.utimes(fields.path.dest, fields.stats.atime, fields.stats.mtime, cb);
							});
						});
					} else {
						log.info('Not exist file for path', {
							path: fields.path
						});
						cb();
					}
				});
				break;
			case 'move':
			case 'rename':
				fs.mkdirs(path.dirname(fields.path.dest), (err) => {
					if (err) return cb(err);
					
					// fs.move(fields.path.src, fields.path.dest, function (err) {
					// 	if (err) return cb(err);
					//	
					// 	me.utimes(fields.path.dest, fields.stats.atime_sec, fields.stats.atime_nsec, fields.stats.mtime_sec, fields.stats.mtime_nsec, cb);
					// });
					
					if (files.file) {
						fs.mkdirs(path.dirname(fields.path.dest), (err) => {
							if (err) return cb(err);
							
							// Перемещаем файл из временной директории в нужное место
							fs.move(files.file.path, fields.path.dest, {clobber: true}, function (err) {
								if (err) return cb(err);
								
								fields.stats = me.convertOldStats(fields.stats);
								// me.utimes(fields.path.dest, fields.stats.atime_sec, fields.stats.atime_nsec, fields.stats.mtime_sec, fields.stats.mtime_nsec, function (err) {
								me.utimes(fields.path.dest, fields.stats.atime, fields.stats.mtime, function (err) {
									if (err) return cb(err);
									
									// Так как это команда перемещения файла, то исходящий файл необходимо удалить
									fs.unlink(fields.path.src, cb);
								});
								
							});
						});
					} else {
						log.info('Not exist file for path', {
							path: fields.path
						});
						cb();
					}
				});
				break;
			case 'symlink':
				fs.mkdirs(path.dirname(fields.path.dest), (err) => {
					if (err) return cb(err);
					
					fs.symlink(fields.path.src, fields.path.dest, function (err) {
						if (err) return cb(err);
						
						fields.stats = me.convertOldStats(fields.stats);
						me.utimes(fields.path.dest, fields.stats.atime, fields.stats.mtime, cb);
					});
				});
				break;
			default:
				log.info('command not found', {
					command: fields.command,
					path: fields.path
				});
				cb();
		}
	}
	
	//TODO чтобы в бою поддерживались старые данные, временно юзаем этот конвертер
	convertOldStats(stats) {
		if (stats && stats.atime_sec) {
			stats.atime = stats.atime_sec + '.' + stats.atime_nsec;
			stats.atime = stats.mtime_sec + '.' + stats.mtime_nsec;
		}
		
		return stats;
	}
}
