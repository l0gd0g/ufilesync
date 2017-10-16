'use strict';

module.exports = {
	rabbitmq          : {
		exchange      : '',
		
		connectionConfig: {
			host         : 'localhost',
			port         : 5672,
			login        : 'guest',
			password     : 'guest',
			prefetchCount: 1,
		}
	},
	
	// Включть/выключить отправку файлов на синхронизацию.
	isRunSync     : true,
	
	// Включить отладку. В консоль будет выводится вся отладочная информация для всех операций.
	isRunDebugMode: true,
	
	// Если массив не пустой, то дебажит только перечисленные методы
	debugCommands: [],
	
	// Полный путь к директории проекта
	baseDir      : '/home/www/my_project',
	
	// Директории, которые будут под синхронизацией(если в пути файла встретится "эта" директория, то файл будет отдан на синхронизаци)
	watchDirs       : ['public'],
	
	// Методы, которые разрешены к использованию в модуле
	supportedMethods: ['Stats', 'mkdirp', 'access', 'accessSync', 'exists', 'existsSync', 'readFile', 'close', 'closeSync', 'rename', 'truncate', 'readdir', 'readdirSync', 'fstat', 'lstat', 'stat', 'fstatSync', 'lstatSync', 'statSync', 'readlink', 'readlinkSync', 'unlink', 'fchmod', 'fchmodSync', 'chmod', 'chmodSync', 'fchown', 'fchownSync', 'chown', 'chownSync', '_toUnixTimestamp', 'utimes', 'utimesSync', 'futimes', 'futimesSync', 'watch', 'watchFile', 'unwatchFile', 'realpathSync', 'realpath', 'createReadStream', 'ReadStream', 'FileReadStream', 'createWriteStream', 'lutimes', 'lutimesSync', 'lchown', 'lchmod', 'lchownSync', 'lchmodSync', 'ensureDir', 'ensureDirSync', 'remove', 'outputJsonSync', 'readJson', 'readJSON', 'readJsonSync', 'readJSONSync', 'readFileSync', 'copy', 'open'],
	
	// Методы, которые будут обернуты в обработчик
	wrapMethods: ['mkdir', 'mkdirp', 'mkdirs', 'writeFile', 'rename', 'truncate', 'symlink', 'move', 'copyFile', 'unlink', 'rmdir', 'remove', 'outputFile', 'copy'],
	
	// Методы, для которых требуется передача файла на дублирующие сервера
	fileSendMethods : ['write', 'writeFile', 'createWriteStream', 'rename', 'move', 'copy', 'copyFile'],
	
	// Методы, для которых требуется получение даты создания(объект stats)
	fileGetStats: ['mkdirp', 'mkdirs', 'mkdir', 'write', 'writeFile', 'createWriteStream', 'copy', 'copyFile', 'move', 'rename', 'symlink'],
	
	timeDelaySymlink     : 1000,
	timeoutPublishMessage: 2000,
	receivers            : {
		reserve: {
			domainName      : 'domain.ru',
			port            : 1234,
			maxFieldsSize   : 10 * 1024 * 1024 * 1024,
			uploadDir       : 'tmp',
			isUseRemoveFiles: false,
		},
	},
	transmitters            : {
		reserve: {
			domainName      : 'domain.ru',
			port            : 1234,
			pathToStorage   : 'usync_storage/reserve',
			timeReconnect   : 5000,
			queuePrefix     : 'sync_reserve'
		},
	},
};
