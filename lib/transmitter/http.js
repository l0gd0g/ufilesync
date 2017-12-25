'use strict';
const amqp = require('amqp');
const fs = require('fs-extra');
const async = require('async');
const FormData = require('form-data');
const exceptions = require('../exceptions');
const USync = require('../usync');

const http = require('http');
const keepAliveAgent = new http.Agent({keepAlive: true});

const amqplib = require('amqplib/callback_api');


class Transmitter {
	
	constructor(config, processedLetters) {
		this.config = config;
		this.processedLetters = processedLetters || '-_abcdefghijklmnopqrstuvwxyz0123456789'.split('');
		
		// массивы с коллбэками по действиям
		this.onAction = {
			connected   : [],
			consume     : [],
			error       : [],
			taskComplete: []
		};
		
		this.isConnected = false;
		
		// Изначальное время задержки при повторной отправки сообщения
		this.timeoutDeferSend = this.config.timeReconnect;
		
		this.stackTasks = {};
		
		this.connectToRabbitMq();
	}
	
	debug(message) {
		console.log(message);
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
	fireEventTaskComplete(task) {
		const me = this;
		
		if (task.message.dates) task.message.dates.end = new Date();
		
		
		me.onAction.taskComplete.forEach(cb => {
			cb(task);
		});
	}
	
	
	/**
	 * Запуск событий, когда готов коннект к RabbitMq
	 */
	fireEventConnected() {
		const me = this;
		me.isConnected = true;
		me.onAction.connected.forEach(cb => {
			cb();
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
	
	/**
	 * Запуск события, когда пришло сообщение от RabbitMQ
	 */
	fireEventTaskConsume(task) {
		const me = this;
		
		me.onAction.consume.forEach(cb => {
			cb(task);
		});
	}
	
	/**
	 * Подсоедениться к rbmq
	 */
	connectToRabbitMq() {
		const me = this;
		
		amqplib.connect(me.config.rabbitmq.connectionConfig, function (err, connection) {
			if (err) {
				return me.fireEventError(err);
			}
			me.rbmqConnection = connection;
			
			me.fireEventConnected();
			
			
			
			me.rbmqConnection.createChannel((err, channel) => {
				if (err) {
					return me.fireEventError(err);
				}
				me.channel = channel;
				
				me.channel.on('error', err => {
					me.fireEventError(err);
				});
				
				me.channel.prefetch(me.config.prefetchCount);
				
				me.debug(`Prefetch count on channel: ${me.config.prefetchCount}`);
				
				let countQueues = 0;
				
				USync.eachQueues(
					me.processedLetters,
					me.config.levelDeepQueuePostfix,
					me.config.queuePrefix,
					1,
					(name, cb) => {
						countQueues++;

						me.rbmqQueueSubscribe(name);
						cb();
					},
					() => {
						me.debug(`Connected to ${countQueues} queues`);
					}
				);
			});
		});
	}
	
	/**
	 * Подписка на очередь
	 * @param queueName
	 */
	rbmqQueueSubscribe(queueName) {
		const me = this;
		
		// Создаем очередь или подключаемся к уже существующей
		me.channel.assertQueue(queueName, me.config.rabbitmq.queueConfig);
		me.debug(`Queue ${queueName} assert`);
		
		let queue = async.cargo(function(stackTasks, cb) {
			me.sendStack(stackTasks, me.processResponse(stackTasks, cb));
		}, me.config.prefetchCount);
		
		// Подписуемся на очередь
		me.channel.consume(queueName, function(task) {
			if (task !== null) {
				
				me.fireEventTaskConsume(task);
				
				task.message = JSON.parse(task.content.toString());
				task.queueName = queueName;
				
				if (task.message.dates) task.message.dates.process = new Date();
				
				queue.push(task);
			} else {
				me.fireEventError(new Error('Task is empty'));
			}
		});
	}
	
	deferSend(stackTasks, cb) {
		let me = this;
		setTimeout(() => {
			// Пытаемся отправить еще раз и сразу увеличиваем время задержки в 2 раза
			me.timeoutDeferSend = me.timeoutDeferSend * 2;
			
			me.sendStack(stackTasks, me.processResponse(stackTasks, cb));
		}, me.timeoutDeferSend);
	}
	
	/**
	 * Обработать ответ от вторго сервера
	 * @param {Object} task
	 */
	processResponse(stackTasks, cb) {
		const me = this;
		
		return (err, response, body) => {
			if (err) {
				// Так как произошел какой-то пиздец при попытке отправить задачу, кидаем в лог и фейлим ошибку
				me.fireEventError(err);
				
				// Если нет соеденения, еще раз пробуем отправить через время
				if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].indexOf(err.code) != -1) {
					me.deferSend(stackTasks, cb);
				} else {
					
					me.stackFail(err, stackTasks);
					cb();
				}
			} else {
				// Сбрасываем время задержки при повторной отправки сообщения
				me.timeoutDeferSend = me.config.timeReconnect;
				
				switch (response.statusCode) {
					case 200:
						// Обрабатываем результат выполнения задач
						me.processResponseTasks(stackTasks);
						cb();
						
						break;
					case 503:
						me.stackFail(body, stackTasks);
						cb();
						
						break;
					default:
						// Пробуем еще раз переотправить задачу
						me.deferSend(stackTasks, cb);
				}
			}
		}
	}
	
	
	/**
	 * Ошибка выполнения задачи
	 * @param err Ошибка пришедшая от второго сервера
	 * @param task
	 */
	taskFail(err, task) {
		const me = this;
		
		const obj = {
			error  : err,
			message: task.message,
			queue  : task.queueName
		};
		me.debug(obj);
		me.fireEventError(obj);
		
		// Озмечаем задачу в очереди "выполненной"
		me.channel.ack(task);
	}
	
	
	/**
	 * Озмечаем задачу в очереди выполненной
	 * @param  {Object} task
	 */
	taskComplete(task) {
		const me = this;
		
		if (task.message.dates) task.message.dates.complete = new Date();
		
		me.removeFromStorage(task, (err) => {
			if (err) {
				me.debug({
					error    : err,
					message  : task.message,
					queueName: task.queueName
				});
			}
			
			me.fireEventTaskComplete(task);
			
			me.channel.ack(task);
		});
	}
	
	/**
	 * Обработка ошибки в стеке задач
	 * @param err
	 * @param stackTasks
	 */
	stackFail(err, stackTasks) {
		const me = this;
		
		const obj = {
			error: err,
			stack: []
		};
		
		// Озмечаем задачу в очереди "выполненной"
		async.eachSeries(
			stackTasks,
			(task, cb) => {
				// me.taskFail(err, task);
				
				obj.stack.push(task.message);
				me.channel.ack(task);
				cb();
			},
			err => {
				if (err) {
					me.fireEventError(err);
				}
				
				me.debug(obj);
				me.fireEventError(obj);
				
			}
		);
	}
	
	/**
	 * Обработка ответа с стеком задач
	 * @param stackTasks
	 * @param body
	 */
	processResponseTasks(stackTasks) {
		const me = this;
		
		async.each(
			stackTasks,
			(task, cb) => {
				me.taskComplete(task);
				cb();
			},
			err => {
				if (err) {
					me.fireEventError(err);
				}
			}
		);
	}
	
	
	
	/**
	 * Удалить файл из хранилища
	 * @param task
	 * @param cb
	 */
	removeFromStorage(task, cb) {
		fs.access(task.message.path.store, fs.R_OK, (err) => {
			if (err) return cb();
			
			fs.unlink(task.message.path.store, cb);
		});
	}
	
	/**
	 * Отправить стек задач на другой сервер
	 * @param  {Object}   task Стек задач из очереди
	 * @param  {Function} cb
	 */
	sendStack(stackTasks, cb) {
		const me = this;
		const form = new FormData();
		
		const options = {
			hostname: me.config.domainName,
			port    : me.config.port,
			path    : '/upload',
			method  : 'POST',
			agent   : keepAliveAgent,
			timeout: 500,
		};
		
		const queueNameCnt = {};
		
		const prepareData = [];
		
		async.eachSeries(
			stackTasks,
			(task, cb) => {
				if (task.message.dates) task.message.dates.send = new Date();
				
				if (! queueNameCnt[task.queueName]) queueNameCnt[task.queueName] = 0;
				queueNameCnt[task.queueName]++;
				
				// Если команда для записи файла, то нужно передать и сам файл
				if (-1 !== me.config.fileSendMethods.indexOf(task.message.command)) {
					fs.stat(task.message.path.store, (err, stat) => {
						
						// Если какой-то пиздец уже тут, то нахер эту задачу
						if (err) {
							me.taskFail(err, task);
							cb();
						} else if( ! stat.isDirectory()) {
							let stream = fs.createReadStream(task.message.path.store);
							stream.on('error', err => {
								me.fireEventError(err);
							});
							
							prepareData.push(task.message);
							form.append(task.message.id, stream);
							
							cb();
						} else {
							cb();
						}
					});
				} else {
					me.debug({message: task.message, queue: task.queueName});
					prepareData.push(task.message);
					
					cb();
				}
			},
			err => {
				if (err) {
					me.fireEventError(err);
					return cb(err);
				}
				
				me.debug(`Stack length to be send: ${stackTasks.length} | ${JSON.stringify(queueNameCnt)}`);
				
				form.append('tasks', JSON.stringify(prepareData));
				
				options.headers = form.getHeaders();
				
				const request = http.request(options, response => {
					let body = '';
					
					response.setEncoding('utf8');
					response.on('data', (chunk) => {
						body += chunk;
					});
					response.on('end', () => {
						cb(null, response, body);
					});
				});
				
				request.on('error', (err) => {
					cb(err);
				});
				
				form.pipe(request);
				
				form.on('end', () => {
					request.end();
				});
			}
		);
	}
	
}

module.exports = Transmitter;
