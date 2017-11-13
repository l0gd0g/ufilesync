'use strict';

const fstime = require('fstime');
const exceptions = require('./exceptions');
const urlencode = require('urlencode');
const async = require('async');
const path = require('path');

/**
 * Базовый класс
 */
class Task {
	constructor() {
		this.dateCreate = new Date();
		this.exceptions = exceptions;
		
		this.dates = {
			// Время создание задачи
			begin: this.dateCreate,
			
			// Время начала выполнения функции модулем fs
			fs: 0,
			
			// Время начала операции сохранения файлов в хранилище
			storage: 0,
			
			// Время начала отправки задачи в RabbitMq
			push: 0,
		};
		
	}
	
	/**
	 * Сколько прошло времени с момента создания задачи
	 * @returns {number}
	 */
	getTimeElapsed() {
		return new Date().getTime() - this.dates.begin.getTime();
	}
	
	/**
	 * Запомнить время окончание операции
	 * @param key
	 */
	setTimeStartDebug(key) {
		this.dates[key] = new Date();
	}
	
}


/**
 * Объект "задачи" пропускающий отправку в очередь для синхронизации
 */
class Skip extends Task {
}


/**
 * Объект "задачи" отправляемый в очердь для синхронизации
 */
class Simple extends Task {
	
	/**
	 * @param config Object - Конфиг uSync.config.
	 * @param command String - Метка(Инициатор отпрачки уведовления). В основном для удобного логирования.
	 * @param _path String || Object{src, dest} - путь к папке для синхронизации
	 * @param queueName String - название очереди
	 * @param subject String - описание операции
	 * @param timeDelay Number - время задержки перед отправкой задачи синхронизации на выполнение (нужно для симлинов!)
	 * @param debug Boolean - включить вывод отладочной информации для этой задачи
	 */
	constructor(config, command, _path, queueName, subject, timeDelay, debug) {
		super();
		
		this.config = config;
		this.path = {
			src  : _path.src || _path,
			dest : _path.dest || '',
			store: ''
		};
		let maxLength = 200;
		
		let idPostfix = new Date().getTime() + '_' + Math.floor(Math.random() * 999);
		
		//Решили хранить с полным путем + время + случайное число
		this.id = this.path.src.substr(0, maxLength) + '_' + idPostfix;
		
		let match = path.normalize(this.path.dest || this.path.src).match(this.config.regExpFindPathStorage);
		if (match && match.length >= 3) {
			this.id = `${match[1] + urlencode(match[3]).substr(0, maxLength)}_${idPostfix}`;
			this.path.store = this.id;
		} else {
			this.id = `${path.normalize(this.path.dest || this.path.src).substr(0, maxLength)}_${idPostfix}`;
		}
		
		this.queueNamePostfix = queueName || 'other';
		this.timeDelay = timeDelay || 0;
		this.debug = debug || false;
		this.subject = subject || command;
		this.command = command;
		this.stats = '';
		this.additionalParams = {};// Дополнительные параметры
		
		// Для каждого сервера(receiver) будет подготовлен свой набор данных для передачи
		this.messages = {};
		
		// Для каждого ресивера нужен свой набор данных
		async.eachOf(
			this.config.transmitters,
			(transmitter, idx) => {
				this.messages[idx] = {
					id       : this.id,
					queueName: transmitter.queuePrefix + '_' + this.queueNamePostfix,
					dates    : this.dates,
					subject  : this.subject,
					command  : this.command,
					stats    : this.stats,
					path     : {
						src  : this.path.src,
						dest : this.path.dest,
						store: ''
					},
				};
				
				if (this.path.store) this.messages[idx].path.store = transmitter.pathToStorage + '/' + this.path.store;
			});
	}
	
	/**
	 * Получить от файла необходимую информацию
	 * @param cb
	 */
	fillStatsIfNeed(path, cb) {
		if (this.config.fileGetStats.indexOf(this.command) !== -1) {
			try {
				this.stats = fstime.statSync(path);
				
				async.each(
					this.messages,
					(message, cb) => {
						message.stats = this.stats;
						cb();
					},
					cb
				);
			} catch (err) {
				cb(new exceptions.ErrorTask(this, err.message));
			}
		} else {
			cb();
		}
	}
	
	getPathInStorage(pathToStorage) {
		return `${pathToStorage}/${this.id}`;
	}
}


class Symlink extends Simple {
	constructor(config, path, queueName, subject, debug) {
		// Для symlink нужна задержка
		super(config, 'symlink', path, queueName, subject, config.timeDelaySymlink, debug);
	}
}

module.exports = {
	Task   : Task,
	Skip   : Skip,
	Simple : Simple,
	symlink: Symlink,
};
