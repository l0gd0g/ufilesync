'use strict';
const amqp = require('amqp');
const fs = require('fs-extra');
const async = require('async');
const FormData = require('form-data');
const exceptions = require('../exceptions');

class Transmitter {
	
	constructor(config, processedLetters) {
		this.config = config;
		this.processedLetters = processedLetters || '-_abcdefghijklmnopqrstuvwxyz0123456789'.split('');
		
		// массивы с коллбэками по действиям
		this.onAction = {
			connected   : [],
			error       : [],
			taskComplete: []
		};
		
		this.isConnected = false;
		
		this.stackPeviousTasks = {};
		
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
	 * Подсоедениться к rbmq
	 */
	connectToRabbitMq() {
		const me = this;
		
		me.rbmqConnection = amqp.createConnection(me.config.rabbitmq)
			.on('ready', () => {
				me.isConnected = true;
				me.debug(`Transmitter connect to ${me.config.rabbitmq.host}`);
				me.fireEventConnected();
				
				me.rbmqConnection.exchange(me.config.rabbitmq.exchange, {confirm: true, durable: true}, exchange => {
					me.rbmqExchange = exchange;
					
					me.processedLetters.forEach(letter => {
						// me.stackPeviousTasks[letter];
						me.rbmqQueueSubscribe(me.config.queuePrefix + '_' + letter);
					});
				});
			})
			.on('error', err => {
				me.fireEventError(err);
			});
	}
	
	/**
	 * Подписка на очередь
	 * @param queueName
	 */
	rbmqQueueSubscribe(queueName) {
		const me = this;
		
		// Создаем очередь или подключаемся к уже существующей
		me.rbmqConnection.queue(queueName, {autoDelete: false, durable: true}, rbtQueue => {
			me.debug(`Queue ${queueName} is open`);
			
			// Подписываемся на сообщения этой очереди
			rbtQueue.subscribe(
				{
					ack          : true,
					prefetchCount: 1, // Количество записей забираемых из RabbitMq
				},
				(message, headers, deliveryInfo, task) => {
					task.message = JSON.parse(message.data.toString());
					task.queueName = queueName;
					
					if (task.message.dates) task.message.dates.process = new Date();
					
					// Отправляем задачу на выполнение
					me.send(task, me.processResponse(task));
					
				}
			);
		});
	}
	
	/**
	 * Обработать ответ от вторго сервера
	 * @param {Object} task
	 */
	processResponse(task) {
		const me = this;
		
		return (err, response, body) => {
			if (err) {
				// Так как произошел какой-то пиздец при попытке отправить задачу, кидаем в лог и фейлим ошибку
				me.fireEventError(err);
				
				// Если нет соеденения, то тафймаут и еще раз пробуем отправить
				if (-1 != err.toString().indexOf('ECONNREFUSED') || -1 != err.toString().indexOf('ETIMEDOUT')) {
					setTimeout(() => {
						me.send(task, me.processResponse(task));
					}, me.config.timeReconnect);
				} else {
					// Если произошедший пиздец, совсем пиздец, то отправляем задачу в очередь ошибок
					me.taskFail(err, task);
				}
			} else {
				switch (response.statusCode) {
					case 200:
						me.taskComplete(task, body);
						break;
					case 503:
						me.taskFail(body, task);
						break;
					default:
						// Пробуем еще раз переотправить задачу
						setTimeout(() => {
							me.send(task, me.processResponse(task));
						}, me.config.timeReconnect);
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
		task.acknowledge();
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
			
			task.acknowledge();
		});
	}
	
	
	/**
	 * Отправить задачу о синхронизации на другой сервер
	 * @param  {Object}   task Задача пришедшая из очереди
	 * @param  {Function} cb
	 */
	send(task, cb) {
		const me = this;
		const form = new FormData();
		
		if (task.message.dates) task.message.dates.send = new Date();
		
		me.debug({message: task.message, queue: task.queueName});
		
		async.parallel(
			[
				cb => {
					async.eachOf(
						task.message,
						(value, idx, cb) => {
							if (typeof value === "object") {
								form.append(idx, JSON.stringify(value));
							} else {
								form.append(idx, value);
							}
							cb();
						},
						cb
					);
				},
				cb => {
					// Если команда для записи файла, то нужно передать и сам файл
					if (-1 != me.config.fileSendMethods.indexOf(task.message.command)) {
						fs.stat(task.message.path.store, (err, stat) => {
							if (! stat.isDirectory()) {
								if (!err) {
									let stream = fs.createReadStream(task.message.path.store);
									stream.on('error', err => {
										me.fireEventError(err);
									});
									
									form.append('file', stream);
								}
							}
							
							cb(err);
						});
					} else {
						cb();
					}
				},
			], err => {
				if (err) {
					cb(err);
				} else {
					form.submit('http://' + me.config.domainName + ':' + me.config.port + '/upload', function (err, response) {
						if (err) {
							cb(err, response);
						} else {
							let body = '';
							
							response.on('data', function (chunk) {
								body = body + chunk.toString();
							});
							
							response.on('end', function () {
								cb(null, response, body);
							});
						}
					});
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
	
}

module.exports = Transmitter;
