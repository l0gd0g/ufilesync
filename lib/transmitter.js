#!/usr/bin/node.sh
'use strict';
/**
 * Created by Maxim on 02.09.2016.
 */

//FIXME при старте выполянть тест соеденения 

const amqp     = require('amqp');
const config   = require('conf.js');
const path     = require('path');
const bunyan   = require('bunyan');
const fs = require('fs-extra');
const async = require('async');
var FormData = require('form-data');

const processedLetters = '-_abcdefghijklmnopqrstuvwxyz0123456789'.split('');

const log = bunyan.createLogger({
	name   : 'usync_transmitter',
	streams: [
		{
			level: 'info',
			path : path.join(config.path.baseDirLog, 'usync_transmitter_info.log')
		},
		{
			level: 'error',
			path : path.join(config.path.baseDirLog, 'usync_transmitter_error.log')
		}
	]
});


class Transmitter {
	
	constructor(config, queueName) {
		this.config = config;
		this.queueName = queueName;
		this.rbmqConnect();
	}
	
	
	/**
	 * Подсоедениться к rbmq
	 */
	rbmqConnect() {
		var me = this;
		
		me.rbmqConnection = amqp.createConnection(me.config.rabbitmq.connectionConfig)
			.on('ready', function () {
				log.error('connection ready ' + me.config.rabbitmq.connectionConfig.host);
				
				me.rbmqConnection.exchange(me.config.uSync.exchange, {confirm: true, autoDelete: false}, function (exchange) {
					me.rbmqExchange = exchange;
					
					// // Создаем очередь для логирования ошибок, если ее нет
					// me.rbmqConnection.queue(me.config.uSync.queueNameError, {confirm: true, autoDelete: false}, function (queue) {
					// 	console.log('Queue ' + queue.name + ' is open');
					// });
					
					me.getProcessedLetters().forEach(function(letter) {
						me.rbmqQueueSubscribe(config.uSync.queueNameSyncFiles + '_' + letter);
					});
					
					me.rbmqQueueSubscribe(config.uSync.queueNameSyncFiles + '_other');
				});
			})
			.on('error', err => {
				me._onErrorHandler('error on rabbit connection', err)
			});
	}
	
	
	/**
	 * Получить список букв из параметров или из дефолта
	 * Которые надо отправлять на синхронизанию (префиксы очереди)
	 * @returns {Array}
	 */
	getProcessedLetters () {
		if (this.processedLetters) return this.processedLetters;
		
		if (process.argv[2]) {
			return this.processedLetters = process.argv[2].split('');
		} else {
			return this.processedLetters = processedLetters;
		}
	}
	
	
	/**
	 * Подписка на очередь
	 * @param queueName
	 */
	rbmqQueueSubscribe (queueName) {
		var me = this;
		
		// Создаем очередь или подключаемся к уже существующей
		me.rbmqConnection.queue(queueName, {autoDelete: false}, function (rbtQueue) {
			log.error(`Queue ${queueName} is open`);
			
			// Подписываемся на сообщения этой очереди
			rbtQueue.subscribe(
				{
					ack: true,
					prefetchCount: me.config.uSync.fileSync.prefetchCount
				},
				function (message, headers, deliveryInfo, task) {
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
		var me = this;
		
		return (err, response, body) => {
			if (err) {
				// Так как произошел какой-то пиздец при попытке отправить задачу, кидаем в лог и фейлим ошибку
				me._onErrorHandler('send error', err);
				
				// Если нет соеденения, то тафймаут и еще раз пробуем отправить
				if (-1 != err.toString().indexOf('ECONNREFUSED') || -1 != err.toString().indexOf('ETIMEDOUT')) {
					setTimeout(() => {
						me.send(task, me.processResponse(task));
					}, me.config.uSync.fileSync.timeReconnect);
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
						}, me.config.uSync.fileSync.timeReconnect);
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
		task.error = err;
		
		log.error('error from second server',{
			error: err,
			message:task.message,
			queueName: task.queueName
		});
		
		// асинхронно отправляем задачу в очередь ошибок
		// me.rbmqPushErrorQueue(task,(err) => {
		// 	if (err) {
		// 		me._onErrorHandler('send to errorQueue error', err);
		// 	}
		// });
		
		// Озмечаем задачу в очереди выполненной
		task.acknowledge();
	}
	
	
	/**
	 * Озмечаем задачу в очереди выполненной
	 * @param  {Object} task
	 */
	taskComplete(task) {
		this.removeFromStorage(task, (err) => {
			if(err) {
				log.error('error after remove from storage',{
					error: err,
					message:task.message,
					queueName: task.queueName
				});
			}
			
			task.acknowledge();
		});
	}
	
	
	/**
	 * Поместить задачу в очередь ошибок
	 * @param  {Object}   task
	 * @param  {Function} cb
	 */
	rbmqPushErrorQueue(task, cb) {
		var me = this;
		
		task.date = new Date(); 
		
		// console.log(JSON.stringify(task))
		
		me.rbmqExchange.publish(
			me.config.uSync.queueNameError,
			JSON.stringify({
				nameOwner: task.message.nameOwner,
				message  : task.message,
				debug    : task.debug,
				timeDelay: task.timeDelay,
				queueName: task.queueName,
				error    : task.error,
				date     : new Date()
			}),
			{
				deliveryMode: 2,
			},
			cb
		);
	}
	
	
	/**
	 * Отправить задачу о синхронизации на другой сервер
	 * @param  {Object}   task Задача пришедшая из очереди
	 * @param  {Function} cb
	 */
	send (task, cb) {
		var me = this;
		var form = new FormData();
		var paramPath = task.message.path;
		
		if (typeof(paramPath) == "object") {
			paramPath = JSON.stringify(paramPath);
		}
		
		log.info('send command', {
			command: task.message.command,
			path: paramPath
		});
		
		async.parallel(
			[
				(cb) => {
					form.append('path', paramPath);
					form.append('command', task.message.command);
					if (task.message.stats) {
						form.append('stats', JSON.stringify(task.message.stats));
					}
					form.append('subject', task.message.subject || task.message.command);
					cb();
				},
				(cb) => {
					// Если команда для записи файла, то нужно передать и сам файл
					if (-1 != ['write', 'writeFile', 'createWriteStream'].indexOf(task.message.command)) {
						
						fs.access(task.message.path, fs.R_OK, (err)=> {
							if ( ! err) {
								form.append('file', fs.createReadStream(task.message.path));
							}
							cb(err);
						});
					} else {
						cb();
					}
				},
				(cb) => {
					// Если команда для перемещения/копирования файла, то нужно передать и сам файл
					if (-1 != ['rename', 'move', 'copy', 'copyFile'].indexOf(task.message.command)) {
						
						fs.access(task.message.path.dest, fs.R_OK, (err)=> {
							if ( ! err) {
								form.append('file', fs.createReadStream(task.message.path.dest));
							}
							
							cb(err);
						});
					} else {
						cb();
					}
				}
			], (err) => {
				if (err) {
					cb(err);
				} else {
					form.submit('http://' + me.config.uSync.receiver.domainName + ':' + me.config.uSync.receiver.port + '/upload', function (err, response) {
						if (err) {
							cb(err, response);
						} else {
							var body = '';
							
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
	
	removeFromStorage(task, cb){
		fs.unlink(this.config.storageDir + '/' + task.message.id, cb);
	}
	
	_onErrorHandler(msg, err) {
		log.info(msg, {error: err});
	}

}
