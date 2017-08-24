'use strict';

const fstime = require('fstime');
const childProcess = require('child_process');
const exceptions = require('./exceptions');

/**
 * Базовый класс
 */
class Task {
	constructor() {
		// Время создание задачи
		this.dateCreate = new Date();
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
	 * @param path String || Object{src, dest} - путь к папке для синхронизации
	 * @param queueName String - название очереди
	 * @param subject String - описание операции
	 * @param timeDelay Number - время задержки перед отправкой задачи синхронизации на выполнение (нужно для симлинов!)
	 * @param debug Boolean - включить вывод отладочной информации для этой задачи
	 */
	constructor(config, command, path, queueName, subject, timeDelay, debug) {
		super();
		
		this.config = config;
		
		//Решили хранить с полным путем + время + случайное число
		this.id = path.src || path + '_' + new Date().getTime() + '_' + Math.floor(Math.random() * 999);
		
		this.queueName = queueName;
		this.timeDelay = timeDelay || 0;
		this.debug = debug || false;
		
		this.message = {
			id        : this.id,
			dateCreate: this.dateCreate,
			subject   : subject || command,
			command   : command,
			stats     : '',
			receiver  : config.receiver.domainName,
			path      : path,
		};
		
		// Для этих операций необходимо специальное поведение
		// Проверить в рамках одной "буквы" делается ли операция
		if (['move', 'rename'].indexOf(this.message.command) !== -1) {
			// Команде move запрещено переносить вне одной папки и вне одной буквы
			this.config.watchDirs.forEach(function (watchDir) {
				if (path.src.indexOf(watchDir) !== -1) {
					
					// Если dest не содержит в себе ту же папку что и src - падаем с ошибкой
					if (path.dest.indexOf(watchDir) === -1) {
						throw new exceptions.ErrorTask(this, `Not supported command ${this.message.command} between directories ${path.src} and ${path.dest}`);
					}
					
					return false;
				}
			});
		}
		
		// Нельзя создавать файлы, в пути которых содержится симлинк
		if (this.message.command === 'writeFile') {
			if (!this.isCorrectPath()) {
				throw new exceptions.NotSupportedPathSymlink(this, this.message.path)
			}
		}
		
		// Для symlink нужна задержка
		if (this.message.command === 'symlink' && !timeDelay) {
			this.timeDelay = this.config.timeDelaySymlink;
		}
		
		
	}
	
	isCorrectPath() {
		let result = childProcess.execFileSync('readlink', ['-f', `${this.message.path}`], {encoding: 'utf8'});
		if (result) {
			return result.replace(this.config.baseDir + '/', '').replace(' ', '').replace("\n", '') === this.message.path;
		} else {
			return false;
		}
	}
	
	/**
	 * Получить от файла необходимую информацию
	 * @param cb
	 */
	fillStatsIfNeed(cb) {
		if ([
				'mkdirp', 'mkdirs', 'mkdir',
				'write', 'writeFile', 'createWriteStream',
				'copy', 'copyFile',
				'move', 'rename',
				'symlink'
			].indexOf(this.message.command) !== -1) {
			try {
				this.message.stats = fstime.statSync(this.message.path.dest || this.message.path);
				cb();
			} catch (error) {
				cb(new exceptions.ErrorTask(this, error.message));
			}
		} else {
			cb();
		}
	}
}


module.exports = {
	Task  : Task,
	Skip  : Skip,
	Simple: Simple,
};
