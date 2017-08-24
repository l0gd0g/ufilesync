'use strict';

module.exports = {
	baseDir       : null,
	isRunSync     : false, // Включть/выключить отправку файлов на синхронизацию.
	isRunDebugMode: false, // Включить отладку. В консоль будет выводится вся отладочная информация для всех операций.
	
	// Функции которые поддерживаем и разрешены к использованию
	// TODO оставил только те методы, которые я понимал и которые успел проверить, поэтому если нужно будет добавить, добавляем и смотри как работает
	supportedMethods: ['Stats', 'access', 'accessSync', 'exists', 'existsSync', 'readFile', 'close', 'closeSync', 'rename', 'truncate', 'readdir', 'readdirSync', 'fstat', 'lstat', 'stat', 'fstatSync', 'lstatSync', 'statSync', 'readlink', 'readlinkSync', 'unlink', 'fchmod', 'fchmodSync', 'chmod', 'chmodSync', 'fchown', 'fchownSync', 'chown', 'chownSync', '_toUnixTimestamp', 'utimes', 'utimesSync', 'futimes', 'futimesSync', 'watch', 'watchFile', 'unwatchFile', 'realpathSync', 'realpath', 'createReadStream', 'ReadStream', 'FileReadStream', 'createWriteStream', 'lutimes', 'lutimesSync', 'lchown', 'lchmod', 'lchownSync', 'lchmodSync', 'ensureDir', 'ensureDirSync', 'remove', 'outputJsonSync', 'readJson', 'readJSON', 'readJsonSync', 'readJSONSync', 'readFileSync'],
	
	// Функции которые переопределены
	processedMethods: ['mkdir', 'writeFile', 'rename', 'truncate', 'symlink', 'move', 'copyFile', 'unlink', 'rmdir', 'remove', 'outputFile'],
	watchDirs       : ['public'],
	timeDelaySymlink: 500,
	regExpFindDirs  : null,
	rabbitmq        : {
		connectionConfig: {
			host         : 'localhost',
			port         : 5672,
			login        : 'guest',
			password     : 'guest',
			prefetchCount: 1,
		}
	},
	debugCommands   : [],
	
};
