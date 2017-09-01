'use strict';
/**
 * Created by MJ on 02.09.2016.
 *
 * @description Суть всего чтобы переопределить методы модуля для работы с файловой системой и после отработки слать задачу на синхронизацию данных
 *
 *
 * Для отладки одной операции можно передать Task-объект и включиь в нем "debug = true"
 *
 * Проверка рсинком
 * ulight8
 * rsync -avnc --omit-dir-times  public/sitedomains/ rsync://ulight43.uid.me/ulight43/public/sitedomains/
 * rsync -avnc --omit-dir-times  public/sitestatics/ rsync://ulight43.uid.me/ulight43/public/sitestatics/
 *
 * ulight43
 * rsync -avnc --omit-dir-times rsync://ulight43.uid.me/ulight43/public/sitestatics/ public/sitestatics/
 * rsync -avnc --omit-dir-times rsync://ulight43.uid.me/ulight43/public/sitedomains/ public/sitedomains/
 */

const _ = require('lodash');
const fs = require('fs-extra');
const amqp = require('amqp');
const async = require('async');
const path = require('path');

const config = require('../config');
const exceptions = require('./exceptions');
const tasks = require('./tasks');
const DecoratorFactory = require('./decorator_factory');

class USync {
	
	constructor(_config) {
		const me = this;
		
		if (_config) me.config = _.extend(config, _config);
		
		this.processedLetters = '-_abcdefghijklmnopqrstuvwxyz0123456789'.split('');
		
		// Готовим регулярку на обработку нужных директорий
		if (!me.config.regExpFindDirs) me.config.regExpFindDirs = new RegExp(`.*(${me.config.watchDirs.join('|')})\/`, 'i');
		// Флаг показывает, готовы ли мы сейчас отправлять задачи в очередь
		me.isReadyPush = false;
		
		if (!me.config.regExpFindPathStorage) me.config.regExpFindPathStorage = new RegExp(`^((${this.config.watchDirs.join('|')})\/\\w\\/\\w\\/\\w\\/)(.*)$`);
		
		me.possibleQueues = {};
		
		me.isConnected = false;
		
		// массивы с коллбэками по действиям
		me.onAction = {
			ready    : [],
			connected: [],
			error    : [],
			push     : []
		};
		
		// Чтобы всегда под рукой иметь эти объекты, заводим их тут
		me.tasks = tasks;
		me.exceptions = exceptions;
		me.decoratorFactory = new DecoratorFactory(me, me.config);
		
		// Расширяем, запрещаем, разрешаем методы модуля fs
		me.fs = me.decoratorFactory.wrapFs(fs);
		
		// Если синхронизация остановлена, то ничего не отправляем в очередь
		if (me.config.isRunSync === false) {
			me.debug('Synchronization statics not use');
			me.isReadyPush = false;
			
			me.fireEventReady();
		} else {
			me.connectToRabbitMq();
		}
	}
	
	
	/**
	 * Запуск коннекта к RabbitMq
	 */
	connectToRabbitMq() {
		const me = this;
		me.rbmqConnection = amqp.createConnection(me.config.rabbitmq);
		me.rbmqConnection.on('ready', () => {
			me.fireEventConnected();
			
			me.rbmqConnection.exchange(me.config.rabbitmq.exchange, {confirm: true, durable: true}, exchange => {
				me.exchange = exchange;
				
				async.each(
					me.processedLetters,
					(letter, cb) => {
						async.each(
							me.config.receivers,
							(receiver, cb) => {
								// Создаем очередь, чтобы были готовы для отправки в них сообщений
								me.rbmqConnection.queue(receiver.queuePrefix + '_' + letter, {
									autoDelete: false,
									durable   : true
								}, () => {
									me.possibleQueues[receiver.queuePrefix + '_' + letter] = 1;
									cb();
								});
							},
							cb
						);
					},
					err => {
						if (err) {
							me.fireEventError(err);
						} else {
							me.isReadyPush = true;
							me.isConnected = true;
							me.fireEventReady();
						}
					}
				);
			});
		});
		me.rbmqConnection.on('error', function (err) {
			me.fireEventError(err);
		});
	}
	
	
	/**
	 * Обработчик событий
	 * @param cbName
	 * @param cb
	 */
	on(cbName, cb) {
		const me = this;
		if (me.onAction[cbName]) {
			if (cbName === 'ready' && me.isReady) {
				cb();
			} else if (cbName === 'connected' && me.isConnected) {
				cb();
			} else {
				me.onAction[cbName].push(cb);
			}
		} else {
			cb(new me.exceptions.ErrorUSync(cbName + ' - not exist this action'));
		}
	}
	
	
	/**
	 * Запуск событий, когда все готово для работы модуля
	 */
	fireEventReady() {
		const me = this;
		me.isReady = true;
		_.map(me.onAction.ready, function (cb) {
			cb(me.fs);
		});
	}
	
	
	/**
	 * Запуск событий, когда готов коннект к RabbitMq
	 */
	fireEventConnected() {
		const me = this;
		me.isConnected = true;
		_.map(me.onAction.connected, function (cb) {
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
			_.map(me.onAction.error, function (cb) {
				cb(err);
			});
		}
	}
	
	
	/**
	 * Запуск событий, когда отправляем задачу в RabbitMq
	 */
	fireEventPush(task) {
		const me = this;
		_.map(me.onAction.push, cbPush => {
			cbPush(null, task);
		});
	}
	
	
	/**
	 * Вывод отладочной информации
	 */
	debug() {
		let arg = Array.prototype.slice.call(arguments);
		let task = false;
		
		if (arg[0] instanceof this.tasks.Task) {
			task = arg.shift();
		}
		
		if (task && task.debug) {
			console.log.apply(null, arg);
		} else if (this.config.isRunDebugMode) {
			console.log.apply(null, arg);
		}
	}
	
	
	/**
	 * Возвращает задачу для отпарвки в очередь
	 * @param {String} command Метка(Инициатор отпрачки уведовления). В основном для удобного логирования.
	 * @param {String} path Путь к папке для синхронизации
	 * @param {String} queueName Название очереди
	 * @param {String} subject Описание задачи
	 * @param {Number} timeDelay Время задержки
	 * @param {Boolean} debug Флаг отладки
	 * @returns {Object} Task
	 */
	task(command, path, subject, debug) {
		if (!path || command.toString().length === 0) return new this.exceptions.ErrorCreateTask('Param command required');
		if (!command || path.toString().length === 0) return new this.exceptions.ErrorCreateTask('Param path required');
		
		if (this.config.isRunDebugMode) {
			if (this.config.debugCommands.length === 0 || -1 !== this.config.debugCommands.indexOf(command)) {
				debug = true;
			} else {
				debug = false;
			}
		}
		let queueNamePostfix = this.selectQueuePostfix(path.dest || path);
		
		if (queueNamePostfix.length === 0) {
			this.debug(`Not give queueName for path: ${path.dest || path}`);
			return this.taskSkip();
		}
		
		try {
			if (this.tasks[command]) {
				return new this.tasks[command](this.config, path, queueNamePostfix, subject, debug);
			} else {
				return new this.tasks.Simple(this.config, command, path, queueNamePostfix, subject, null, debug);
			}
		} catch (err) {
			let errUSync = new this.exceptions.ErrorUSync(err.message);
			errUSync.stack = err.stack;
			return errUSync;
		}
	}
	
	
	/**
	 * Возвращает задачу для пропуска синхронизации
	 * @returns {Skip}
	 */
	taskSkip() {
		return new this.tasks.Skip();
	}
	
	
	/**
	 * Выбрать очередь, относительно пути
	 * @param path
	 * @returns {string}
	 */
	selectQueuePostfix(path) {
		
		if (this.config.regExpFindDirs.test(path)) {
			return path.replace(this.config.regExpFindDirs, '').replace(/\/.*/i, '');
		}
		
		return '';
	}
	
	
	/**
	 * Отправить задачу на синхронизацию
	 * @param task instanceof Task
	 */
	push(task, cb) {
		const me = this;
		
		// Если не передали колбек, свой лепим, чтобы отловить ошибки
		if (typeof cb === 'undefined') {
			cb = function (err) {
				if (err) me.fireEventError(err);
			}
		}
		
		// Если синхронизация остановлена, то ничего не отправляем в очередь
		if (me.config.isRunSync === false) {
			return cb();
		}
		
		// Если прилетела ошибка, то возвращаем ее
		if (task instanceof me.exceptions.ErrorUSync) {
			return cb(task);
		}
		
		
		// Если задача пришла на пропуск синхронизации, то ничего не отправляем в очередь
		if (task instanceof me.tasks.Skip) {
			return cb();
		}
		
		if (!(task instanceof me.tasks.Simple)) {
			this.debug(task);
			
			return cb(new exceptions.ErrorUSync('Need instanceof Task'));
		}
		
		
		if (!me.exchange) return cb(new exceptions.ErrorRBMQ('Not exist exchange'));
		
		// Перед отправкой нужно получить всю оставшуюся необходимую информацию
		task.fillStatsIfNeed(task.path.dest || task.path.src, err => {
			if (err) return cb(err);
			
			setTimeout(() => {
				
				// На случай, если не ответит RabbitMq
				let timeOutId = setTimeout(() => {
					cb(new me.exceptions.TimeoutPublishMesssage(task, me.config.timeoutPublishMessage));
				}, me.config.timeoutPublishMessage);
				
				async.each(
					task.messages,
					(message, cb) => {
						if (!me.possibleQueues[message.queueName]) {
							clearTimeout(timeOutId);
							
							return cb(new me.exceptions.ErrorTask(task, `Not processed queue: ${message.queueName}`));
						}
						
						//Создаем копию файла(чтобы иметь его состояние в момент выполнения операции)
						me.saveInStorage(message, (err) => {
							if (err) {
								return cb(err);
							}
							
							me.debug(task, `${task.command}(${task.id}) push begin ${message.queueName} | ${(new Date().getTime() - task.dateCreate.getTime())}ms`);
							
							me.exchange.publish(
								message.queueName,
								JSON.stringify(message),
								{deliveryMode: 2, mandatory: true},
								(result) => {
									if (result) {
										cb(new this.exceptions.ErrorTask(task, 'Message not send'));
									} else {
										me.debug(task, `${task.command}(${task.id}) push end ${message.queueName} | ${(new Date().getTime() - task.dateCreate.getTime())}ms`);
										cb();
									}
								}
							);
						});
					},
					err => {
						clearTimeout(timeOutId);
						
						if (err) {
							return cb(err);
						}
						
						me.fireEventPush(task);
						
						cb();
					}
				);
				
			}, task.timeDelay);
			
		});
		
		
	}
	
	saveInStorage(message, cb) {
		if (-1 != this.config.fileSendMethods.indexOf(message.command)) {
			
			fs.mkdirp(path.dirname(message.path.store), err => {
				if (err) return cb(err);
				
				fs.copy(message.path.dest || message.path.src, message.path.store, cb);
			});
		} else {
			cb();
		}
	}
}


module.exports = USync;
