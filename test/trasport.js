'use strict';
const amqplib = require('amqplib/callback_api');


const assert = require('assert');
const fs = require('fs-extra');
const async = require('async');

// let baseDirModule = '/home/projects/ulight/ulight8/node_modules/usync';
const baseDirModule = 'tests';
const baseDirPath = 'test_tmp';

const config = {
	exchange          : '',
	isRunSync         : true,
	isRunDebugMode    : false,
	debugCommands     : [],
	baseDir           : baseDirModule,
	queueNameSyncFiles: 'syncTest',
	watchDirs         : [`${baseDirPath}/sites`, `${baseDirPath}/sites2`],
	
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
			durable   : true
		}
	},
	
	receivers   : {
		reserve: {
			domainName      : 'localhost',
			port            : 33800,
			maxFieldsSize   : 10 * 1024 * 1024 * 1024,
			uploadDir       : `${baseDirPath}/upload`,
			baseDir         : `${baseDirPath}/received`,
			uploadDirBase   : '',
			isUseRemoveFiles: false,
		},
	},
	transmitters: {
		reserve: {
			domainName   : 'localhost',
			port         : 33800,
			pathToStorage: `${baseDirPath}/storage`,
			timeReconnect: 2000,
			queuePrefix  : 'for_test_transmitter',
			prefetchCount: 1
		},
	},
	
	countGenerateTasks: 2,
	processedLetters  : '1234',
	letters           : ['1', '2', '3', '4']
	// letters           : ['t']
};

const debug = function () {
	// console.log.apply(null, arguments);
};

const prepareTask = function (fileName, fileNameStorage, command, letter, cb) {
	
	// Создаем файл оригинал
	fs.writeFile(fileName, `example text...${fileName}`, err => {
		assert.ifError(err);
		
		// Кладем файл(его состояние) в хранилище, для передачи на другой сервер. После выполнения передачи, файл будет удален из хранилища.
		fs.copy(fileName, fileNameStorage, err => {
			assert.ifError(err);
			// debug('write files: ', fileName, fileNameStorage);
			
			fs.lstat(fileName, (err, stats) => {
				assert.ifError(err);
				
				cb(
					null,
					{
						"id"       : fileName,
						"queueName": `${config.transmitters.reserve.queuePrefix}_${letter}`,
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
							"src"  : `${fileName}_${command}`,
							"dest" : `${fileName}_${command}`,
							"store": fileNameStorage
						}
					}
				);
			});
		});
	});
};

const generateRandomTask = function (channel, countGenerateTasks, stackTasks, letter, cb) {
	
	const fileName = `${baseDirPath}/file_`;
	channel.assertQueue(`${config.transmitters.reserve.queuePrefix}_${letter}`, config.rabbitmq.queueConfig);
	
	async.eachOf(
		Array(countGenerateTasks).fill(1).map(() => {
			return `${new Date().getTime()}_${Math.random() * 999}`
		}),
		(item, idx, cb) => {
			prepareTask(fileName + item, `${config.transmitters.reserve.pathToStorage}/tmp_${item}`, "copy", letter, (err, task) => {
				assert.ifError(err);
				
				stackTasks[task.id] = task;
				
				
				if (channel.sendToQueue(task.queueName, Buffer.from(JSON.stringify(task)))) {
					debug(`send to queue ${task.queueName}: ${task.id}`);
				} else {
					debug(`ERROR send to queue ${task.queueName}: ${task.id}`);
				}
				
				cb();
			});
		},
		cb
	);
	
};

describe('Send stack tasks', function () {
	let receiver;
	let transmitter;
	const stackTasks = {};
	let channel;
	let cntComplete = 0;
	
	before(done => {
		amqplib.connect(config.rabbitmq.connectionConfig, function (err, connection) {
			assert.ifError(err);
			
			connection.createChannel((err, _channel) => {
				assert.ifError(err);
				channel = _channel;
				
				channel.on('close', () => {
					assert.ifError(new Error('Channel close'));
					
					debug(err);
				});
				
				channel.on('error', err => {
					assert.ifError(err);
					
					debug(err);
				});
				
				channel.on('return', message => {
					debug(message);
				});
				
				
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
											
											done();
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
		
		receiver.debug = (/* message */) => {
			// debug(message);
		};
		
		receiver.on('error', err => {
			assert.ifError(err);
		});
		
		receiver.on('ready', () => {
			done();
		});
	});
	
	it('start transmitter', function (done) {
		const configTransmitter = config.transmitters.reserve;
		configTransmitter.rabbitmq = config.rabbitmq;
		configTransmitter.fileSendMethods = config.fileSendMethods;
		configTransmitter.levelDeepQueuePostfix = 1;
		
		transmitter = require('../transmitter')(configTransmitter);
		
		transmitter.debug = (message) => {
			debug(message);
		};
		
		transmitter.on('error', err => {
			// assert.ifError(err);
			debug(err);
		});
		
	transmitter.on('consume', (/* message */) => {
			// console.log(message);
		});
		
		transmitter.on('ready', () => {
			done();
		});
	});
		
		it(`send ${config.countGenerateTasks * config.letters.length} by ${config.transmitters.reserve.prefetchCount} tasks with files`, function (done) {
			let isDone = false;
			cntComplete = 0;
			
			transmitter.on('taskComplete', (task) => {
				debug(`complete: ${task.message.id} | ${++cntComplete} | ${Object.keys(stackTasks).length}`);
				delete stackTasks[task.message.id];
				
				if (isDone === false && Object.keys(stackTasks).length === 0) {
					isDone = true;
					
					done();
				}
			});
			
			// Подготавливаем задачи для отправки их в работу
			setTimeout(() => {
				async.parallel(
					config.letters.map(letter => {
						return cb => {
							generateRandomTask(channel, config.countGenerateTasks, stackTasks, letter, cb);
						}
					}),
					() => {
					}
				);
			}, 2000);
		});
		
		
		// it(`RabbitMq close connection`, function (doneClose) {
		// 	let isDone = false;
		// 	let isClose = false;
		// 	cntComplete = 0;
		// 	let cntCompleteClose = 0;
		// 	let cntGenerateTaskStep1 = 1;
		// 	let cntGenerateTaskStep2 = 1;
		// 	let letter = '2';
		// 	let idxFoundChannel;
		// 	/**
		// 	 * Состав супчика:
		// 	 * 1. Создаем очередь
		// 	 * 2. Суем в нее задачи
		// 	 * 3. Обрабатываем и в процессе обработки закрываем один канал
		// 	 * 4. В очередь с закрытым каналом суем еще задач
		// 	 *
		// 	 * Трансмиттер должен уметь переподсоеденяться к закрытому каналу
		// 	 */
		//
		// 	transmitter.on('taskComplete', (task) => {
		// 		cntCompleteClose++;
		//
		// 		if (isClose === false) {
		// 			isClose = true;
		// 			//
		// 			// 	//Канал закрываем
		// 			transmitter.channels[idxFoundChannel].close(err => {
		// 				assert.ifError(err);
		//
		// 				debug(`Close channel on message: ${idxFoundChannel} | ${task.message.id}`);
		//
		//
		// 				// В эту очередь добавляем еще задач
		// 				setTimeout(() => {
		// 					//
		// 					generateRandomTask(channel, cntGenerateTaskStep2, stackTasks, letter, () => {
		// 						debug(`Step 2, generate ${cntGenerateTaskStep2} tasks end for letter "${letter}"`);
		// 					});
		//
		// 				}, 15000);
		//
		//
		// 			});
		// 		}
		//
		// 		debug(cntCompleteClose + ' >= ' + (cntGenerateTaskStep1 + cntGenerateTaskStep2));
		//
		// 		if (
		// 			isDone === false &&
		// 			isClose === true &&
		// 			cntCompleteClose >= (cntGenerateTaskStep1 + cntGenerateTaskStep2)
		// 		) {
		// 			isDone = true;
		//
		// 			doneClose();
		// 		}
		// 	});
		//
		//
		// 	setTimeout(() => {
		//
		// 		debug(Object.keys(stackTasks));
		//
		// 		generateRandomTask(channel, cntGenerateTaskStep1, stackTasks, letter, () => {
		//
		// 			//Ищем индекс очереди, чтобы ее закрыть далее для теста
		// 			Object.keys(transmitter.channels).forEach(idx => {
		// 				if (idx.substr(-1) === letter) {
		// 					idxFoundChannel = idx;
		// 					debug(idxFoundChannel);
		// 				}
		// 			});
		//
		// 			debug(`Step 1, generate ${cntGenerateTaskStep1} tasks end for letter "${letter}" `);
		// 		});
		// 	}, 2000);
		// });
		
	after(done => {
		fs.remove(baseDirPath, () => {
			fs.remove(config.transmitters.reserve.pathToStorage, () => {
				done();
				
				process.exit();
			});
		});
	});
});
