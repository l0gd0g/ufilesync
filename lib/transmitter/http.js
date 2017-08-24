'use strict';
const amqp = require('amqp');
const path = require('path');
const fs = require('fs-extra');
const async = require('async');
const FormData = require('form-data');
const exceptions = require('../exceptions');

//FIXME при старте выполянть тест соеденения с receiver

class Transmitter {
	
	constructor(config, processedLetters) {
		this.config = config;
		// this.queueName = queueName;
		this.processedLetters = processedLetters || '-_abcdefghijklmnopqrstuvwxyz0123456789'.split('');
		
		// массивы с коллбэками по действиям
		this.onAction = {
			connected   : [],
			error       : [],
			taskComplete: []
		};
		
		this.isConnected = false;
		
		this.rbmqConnect();
	}
	
	debug(message) {
		if (this.config.isRunDebugMode) {
			console.log(message);
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
	fireEventTaskComplete(task) {
		const me = this;
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
	rbmqConnect() {
		const me = this;
		
		me.rbmqConnection = amqp.createConnection(me.config.rabbitmq)
			.on('ready', () => {
				me.isConnected = true;
				me.debug(`Transmitter connect to ${me.config.rabbitmq.host}`);
				me.fireEventConnected();
				
				me.rbmqConnection.exchange(me.config.exchange, {confirm: true, autoDelete: false}, exchange => {
					me.rbmqExchange = exchange;
					
					me.processedLetters.forEach(letter => {
						me.rbmqQueueSubscribe(me.config.queueNameSyncFiles + '_' + letter);
					});
					
					me.rbmqQueueSubscribe(me.config.queueNameSyncFiles + '_other');
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
		me.rbmqConnection.queue(queueName, {autoDelete: false}, rbtQueue => {
			me.debug(`Queue ${queueName} is open`);
			
			// Подписываемся на сообщения этой очереди
			rbtQueue.subscribe(
				{
					ack          : true,
					prefetchCount: me.config.fileSync.prefetchCount
				},
				(message, headers, deliveryInfo, task) => {
					task.message = JSON.parse(message.data.toString());
					task.queueName = queueName;
					
					
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
					}, me.config.fileSync.timeReconnect);
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
						}, me.config.fileSync.timeReconnect);
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
		let paramPath = task.message.path;
		
		if (typeof(paramPath) == "object") {
			paramPath = JSON.stringify(paramPath);
		}
		
		me.debug({message: task.message, queue: task.queueName});
		
		async.parallel(
			[
				cb => {
					form.append('path', paramPath);
					form.append('command', task.message.command);
					if (task.message.stats) {
						form.append('stats', JSON.stringify(task.message.stats));
					}
					form.append('subject', task.message.subject || task.message.command);
					cb();
				},
				cb => {
					// Если команда для записи файла, то нужно передать и сам файл
					if (-1 != ['write', 'writeFile', 'createWriteStream'].indexOf(task.message.command)) {
						
						fs.access(task.message.path, fs.R_OK, (err) => {
							if (!err) {
								form.append('file', fs.createReadStream(task.message.path));
							}
							cb(err);
						});
					} else {
						cb();
					}
				},
				cb => {
					// Если команда для перемещения/копирования файла, то нужно передать и сам файл
					if (-1 != ['rename', 'move', 'copy', 'copyFile'].indexOf(task.message.command)) {
						
						fs.access(task.message.path.dest, fs.R_OK, (err) => {
							if (!err) {
								form.append('file', fs.createReadStream(task.message.path.dest));
							}
							
							cb(err);
						});
					} else {
						cb();
					}
				}
			], err => {
				if (err) {
					cb(err);
				} else {
					form.submit('http://' + me.config.receiver.domainName + ':' + me.config.receiver.port + '/upload', function (err, response) {
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
		//TODO удалять директорию, если она пуста. Иначе будет куча пустых директорий и это плохо(как сказал Руслан, "ноды" будут заканчиваться)
		fs.unlink(this.config.storageDir + '/' + task.message.id, cb);
	}
	
}

module.exports = Transmitter;
