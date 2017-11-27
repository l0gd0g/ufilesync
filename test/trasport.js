'use strict';
const amqp = require('amqp');

const assert = require('assert');
const fs = require('fs-extra');
const _ = require('lodash');
const async = require('async');
let baseDirModule = '/home/projects/ulight/ulight8/node_modules/usync';
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
		host         : 'localhost',
		port         : 5672,
		login        : 'test',
		password     : 'test',
		prefetchCount: 1,
	},
	
	receivers   : {
		reserve: {
			domainName      : 'localhost',
			port            : 33800,
			maxFieldsSize   : 10 * 1024 * 1024 * 1024,
			uploadDir       : baseDirPath,
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
			queuePrefix  : 'sync_reserve',
			prefetchCount: 100
		},
	},
	
	countGenerateTasks: 200,
};


let prepareTask = function (fileName, fileNameStorage, command, cb) {
	fs.writeFile(fileName, 'example text...' + fileName, err => {
		assert.ifError(err);
		
		fs.copy(fileName, fileNameStorage, err => {
			assert.ifError(err);
			
			fs.lstat(fileName, (err, stats) => {
				assert.ifError(err);
				
				cb(
					null,
					{
						"id"       : fileName,
						"queueName": config.transmitters.reserve.queuePrefix + '_t',
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
	let exchange;
	
	
	before(done => {
		let rbmqConnection = amqp.createConnection(config.rabbitmq);
		rbmqConnection.on('ready', () => {
			
			rbmqConnection.exchange(config.rabbitmq.exchange, {confirm: true, durable: true}, _exchange => {
				exchange = _exchange;
				
				let fileName = baseDirPath + '/file_';
				
				fs.remove(baseDirPath, err => {
					fs.remove(config.transmitters.reserve.pathToStorage, err => {
						
						
						fs.mkdirp(baseDirPath, err => {
							assert.ifError(err);
							
							fs.mkdirp(config.transmitters.reserve.pathToStorage, err => {
								assert.ifError(err);
								
								
								// Подготавливаем задачи для отправки их в работу
								async.eachOf(
									Array(config.countGenerateTasks).fill(1).map(() => {
										return Math.floor(Math.random() * 999)
									}),
									(item, idx, cb) => {
										prepareTask(fileName + item, config.transmitters.reserve.pathToStorage + '/tmp_' + item, "copy", (err, task) => {
											assert.ifError(err);
											
											stackTasks[task.id] = task;
											
											cb();
										});
									},
									done
								);
								
							});
						});
						
					});
				});
			});
		});
		
		rbmqConnection.on('error', function (err) {
			console.error(err);
		});
	});
	
	it('start receiver', function (done) {
		receiver = require('../receiver')(config.receivers.reserve);
		
		receiver.debug = (message) => {
			// console.log(message);
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
		
		transmitter = require('../transmitter')(configTransmitter, ['t']);
		
		transmitter.debug = (message) => {
			// console.log(message);
		};
		
		transmitter.on('error', err => {
			assert.ifError(err);
			console.log(err);
		});
		
		transmitter.on('ready', () => {
			done();
		});
	});
	
	
	it(`send ${config.transmitters.reserve.prefetchCount} tasks with files`, function (done) {
		transmitter.on('taskComplete', (task) => {
			// console.log(task.message.id);
			
			delete stackTasks[task.message.id];
			
			if (Object.keys(stackTasks).length === 0) {
				done();
			} else {
				// console.log(Object.keys(stackTasks).length);
			}
		});
		
		async.each(
			stackTasks,
			(task, cb) => {
				exchange.publish(
					task.queueName,
					JSON.stringify(task),
					{deliveryMode: 1, mandatory: true},
					() => {
						cb();
					}
				);
			},
			() => {
			
			}
		);
	});
	
	
	after(done => {
		fs.remove(baseDirPath, err => {
			fs.remove(config.transmitters.reserve.pathToStorage, err => {
				done();
			});
		});
	});
});
