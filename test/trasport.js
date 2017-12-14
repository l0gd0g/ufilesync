'use strict';
const amqplib = require('amqplib/callback_api');


const assert = require('assert');
const fs = require('fs-extra');
const _ = require('lodash');
const async = require('async');

// let baseDirModule = '/home/projects/ulight/ulight8/node_modules/usync';
let baseDirModule = 'tests';
let baseDirPath = 'test_tmp';

const config = {
	exchange          : '',
	isRunSync         : true,
	isRunDebugMode    : false,
	debugCommands     : [],
	baseDir           : baseDirModule,
	queueNameSyncFiles: 'syncTest',
	watchDirs         : [baseDirPath + '/sites', baseDirPath + '/sites2'],
	
	fileSendMethods: ['write', 'writeFile', 'createWriteStream', 'rename', 'move', 'copy', 'copyFile'],
	
	rabbitmq: {
		connectionConfig: {
			protocol : 'amqp',
			hostname : 'localhost',
			port     : 5672,
			username : 'guest',
			password : 'guest',
			locale   : 'en_US',
			frameMax : 0,
			heartbeat: 0,
		},
		queueConfig     : {
			autoDelete: true,
			durable   : false
		}
	},
	
	receivers   : {
		reserve: {
			domainName      : 'localhost',
			port            : 33800,
			maxFieldsSize   : 10 * 1024 * 1024 * 1024,
			uploadDir       : baseDirPath + '/upload',
			baseDir         : baseDirPath + '/received',
			uploadDirBase   : '',
			isUseRemoveFiles: false,
		},
	},
	transmitters: {
		reserve: {
			domainName   : 'localhost',
			port         : 33800,
			pathToStorage: baseDirPath + '/storage',
			timeReconnect: 2000,
			queuePrefix  : 'for_test_transmitter',
			prefetchCount: 30
		},
	},
	
	countGenerateTasks: 100,
	letters: ['t', '2']
};

let debug = function () {
	// console.log.apply(null, arguments);
};

let prepareTask = function (fileName, fileNameStorage, command, letter, cb) {
	
	// Создаем файл оригинал
	fs.writeFile(fileName, 'example text...' + fileName, err => {
		assert.ifError(err);
		
		// Кладем файл(его состояние) в хранилище, для передачи на другой сервер. После выполнения передачи, файл будет удален из хранилища.
		fs.copy(fileName, fileNameStorage, err => {
			assert.ifError(err);
			debug('write files: ', fileName, fileNameStorage);
			
			fs.lstat(fileName, (err, stats) => {
				assert.ifError(err);
				
				cb(
					null,
					{
						"id"       : fileName,
						"queueName": config.transmitters.reserve.queuePrefix + '_' + letter,
						"dates"    : {
							"begin"  : new Date(),
							"fs"     : new Date(),
							"storage": new Date(),
							"push"   : new Date(),
						},
						"subject"  : command,
						"command"  : command,
						"stats"    : stats,
						"path"     : {
							"src"  : fileName + '_' + command,
							"dest" : fileName + '_' + command,
							"store": fileNameStorage
						}
					}
				);
			});
		});
	});
};


describe('Send stack tasks', function () {
	let receiver;
	let transmitter;
	let stackTasks = {};
	let channel;
	
	
	before(done => {
		amqplib.connect(config.rabbitmq, function (err, connection) {
			assert.ifError(err);
			
			connection.createChannel((err, _channel) => {
				assert.ifError(err);
				channel = _channel;
				
				channel.on('error', err => {
					assert.ifError(err);
					
					debug(err);
				});
				
				channel.on('return', message => {
					debug(message);
				});
				
				
				let fileName = baseDirPath + '/file_';
				
				// Удаляем все к ебеням!
				fs.remove(baseDirPath, err => {
					assert.ifError(err);
					
					fs.remove(config.receivers.reserve.uploadDir, err => {
						assert.ifError(err);
						
						fs.remove(config.transmitters.reserve.pathToStorage, err => {
							assert.ifError(err);
							
							// Создаем директории
							fs.mkdirp(baseDirPath, err => {
								assert.ifError(err);
								
								fs.mkdirp(config.receivers.reserve.uploadDir, err => {
									assert.ifError(err);
									
									fs.mkdirp(config.receivers.reserve.baseDir, err => {
										assert.ifError(err);
										
										fs.mkdirp(config.transmitters.reserve.pathToStorage, err => {
											assert.ifError(err);
											
											// Подготавливаем задачи для отправки их в работу
											
											async.parallel(
												config.letters.map(letter => {
													return cb => {
														
														async.eachOf(
															Array(config.countGenerateTasks).fill(1).map(() => {
																return `${new Date().getTime()}_${Math.random() * 999}`
															}),
															(item, idx, cb) => {
																prepareTask(fileName + item, config.transmitters.reserve.pathToStorage + '/tmp_' + item, "copy", letter, (err, task) => {
																	assert.ifError(err);
																	
																	stackTasks[task.id] = task;
																	
																	channel.sendToQueue(task.queueName, Buffer.from(JSON.stringify(task)));
																	debug(`send to queue ${task.queueName}: ${task.id}`);
																	
																	cb();
																});
															},
															cb
														);
														
													}
												}),
												() => {
													setTimeout(done, 2000);
												}
											);
											
											
										});
									});
									
								});
							});
						});
					});
				});
			});
		});
	});
	
	it('start receiver', function (done) {
		receiver = require('../receiver')(config.receivers.reserve);
		
		receiver.debug = (message) => {
			debug(message);
		};
		
		receiver.on('error', err => {
			assert.ifError(err);
		});
		
		receiver.on('ready', err => {
			done();
		});
	});
	
	it('start transmitter', function (done) {
		let configTransmitter = config.transmitters.reserve;
		configTransmitter.rabbitmq = config.rabbitmq;
		configTransmitter.fileSendMethods = config.fileSendMethods;
		configTransmitter.levelDeepQueuePostfix = 1;
		
		transmitter = require('../transmitter')(configTransmitter, ['t', '2']);
		
		transmitter.debug = (message) => {
			debug(message);
		};
		
		transmitter.on('error', err => {
			assert.ifError(err);
		});
		
		transmitter.on('ready', () => {
			done();
		});
	});
	
	
	it(`send ${config.countGenerateTasks * config.letters.length} by ${config.transmitters.reserve.prefetchCount} tasks with files`, function (done) {
		let isDone = false;
		transmitter.on('taskComplete', (task) => {
			debug('complete: ' + task.message.id);
			delete stackTasks[task.message.id];
		});
		
		
		let timeInterval = setInterval(() => {
			if (isDone) {
				clearInterval(timeInterval);
				return;
			}
			
			if (Object.keys(stackTasks).length === 0) {
				isDone = true;
				done();
			} else {
				// debug(Object.keys(stackTasks).length);
			}
		}, 200);
		
		
	});
	
	after(done => {
		fs.remove(baseDirPath, err => {
			fs.remove(config.transmitters.reserve.pathToStorage, err => {
				done();
				
				process.exit();
			});
		});
	});
});
