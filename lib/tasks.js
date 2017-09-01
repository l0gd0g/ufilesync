'use strict';

const fstime = require('fstime');
const exceptions = require('./exceptions');
const urlencode = require('urlencode');
const async = require('async');

/**
 * Базовый класс
 */
class Task {
	constructor() {
		// Время создание задачи
		this.dateCreate = new Date();
		this.exceptions = exceptions;
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
		
		let idPostfix = new Date().getTime() + '_' + Math.floor(Math.random() * 999);
		
		//Решили хранить с полным путем + время + случайное число
		this.id = this.path.src + '_' + idPostfix;
		
		let match = (this.path.dest || this.path.src).match(this.config.regExpFindPathStorage);
		if (match && match.length >= 3) {
			this.id = `${match[1] + urlencode(match[3])}_${idPostfix}`;
			this.path.store = this.id;
		} else {
			this.id = `${this.path.dest || this.path.src}_${idPostfix}`;
		}
		
		this.queueNamePostfix = queueName || 'other';
		this.timeDelay = timeDelay || 0;
		this.debug = debug || false;
		this.subject = subject || command;
		this.command = command;
		this.stats = '';
		this.additionalParams = {};// Дополнительные параметры
		
		this.messages = {};
		
		// Для каждого ресивера нужен свой набор данных
		async.eachOf(
			this.config.receivers,
			(receiver, idx) => {
				this.messages[idx] = {
					id        : this.id,
					queueName : receiver.queuePrefix + '_' + this.queueNamePostfix,
					dateCreate: this.dateCreate,
					subject   : this.subject,
					command   : this.command,
					stats     : this.stats,
					path      : {
						src  : this.path.src,
						dest : this.path.dest,
						store: ''
					},
				};
				
				if (this.path.store) this.messages[idx].path.store = receiver.pathToStorage + '/' + this.path.store;
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
	Task     : Task,
	Skip     : Skip,
	Simple   : Simple,
	symlink  : Symlink,
};
