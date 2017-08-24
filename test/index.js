'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
let baseDirModule = '/home/projects/ulight/ulight8/node_modules/usync';
let baseDirPath = 'test_tmp';

const config = {
	exchange          : '',
	isRunSync         : true,
	isRunDebugMode    : false,
	debugCommands     : [],// Если массив не пустой, то дебажит только перечисленные методы
	baseDir           : baseDirModule,
	queueNameSyncFiles: 'syncTest',
	watchDirs         : [baseDirPath + '/sites', baseDirPath + '/sites2'],
	supportedMethods  : ['open', 'Stats', 'mkdirp', 'access', 'accessSync', 'exists', 'existsSync', 'readFile', 'close', 'closeSync', 'rename', 'truncate', 'readdir', 'readdirSync', 'fstat', 'lstat', 'stat', 'fstatSync', 'lstatSync', 'statSync', 'readlink', 'readlinkSync', 'unlink', 'fchmod', 'fchmodSync', 'chmod', 'chmodSync', 'fchown', 'fchownSync', 'chown', 'chownSync', '_toUnixTimestamp', 'utimes', 'utimesSync', 'futimes', 'futimesSync', 'watch', 'watchFile', 'unwatchFile', 'realpathSync', 'realpath', 'createReadStream', 'ReadStream', 'FileReadStream', 'createWriteStream', 'lutimes', 'lutimesSync', 'lchown', 'lchmod', 'lchownSync', 'lchmodSync', 'ensureDir', 'ensureDirSync', 'remove', 'outputJsonSync', 'readJson', 'readJSON', 'readJsonSync', 'readJSONSync', 'readFileSync'],
	processedMethods  : ['mkdir', 'mkdirp', 'writeFile', 'rename', 'truncate', 'symlink', 'move', 'copyFile', 'unlink', 'rmdir', 'remove', 'outputFile'],
	
	fileSync          : {
		prefetchCount: 1,// Количество записей забираемых из RabbitMq
		timeReconnect: 5000,
		port         : 3388
	},
	
	receiver          : {
		domainName   : 'ulight43.uid.me',
		port         : 3388,
		uploadDir    : baseDirPath,
		maxFieldsSize: 10 * 1024 * 1024 * 1024
	},
	timeDelaySymlink  : 1000,
	storageDir        : 'usync_storage',
	fileSendMethods   : ['write', 'writeFile', 'createWriteStream', 'rename', 'move', 'copy', 'copyFile'],
	rabbitmq          : {
		host         : 'localhost',
		port         : 5672,
		login        : 'guest',
		password     : 'guest',
		prefetchCount: 1,
	},
	
	receivers: [
		{
			pathToStorage: 'storage/ul1',
			domainName   : 'ulight43.uid.me',
			port         : 3388,
		},
		{
			pathToStorage: 'storage/ul1',
			domainName   : 'ulight43.uid.me',
			port         : 3388,
		},
	]
};

const uSync = require('usync')(config);

describe('Test deprecated methods', function () {
	
	it('openSync', function (done) {
		try {
			uSync.fs.openSync('testFile', 'w');
			done();
		} catch (err) {
			if (err instanceof uSync.exceptions.DeprecatedSyncFunctions) {
				assert.ok(1);
			} else {
				assert.ok(false);
			}
			done();
		}
	});
});

describe('Test decorator', function () {
	let fileName = 'tmpFile.txt';
	let siteDirPath = '/sites/a/b/c/abc-sitename';
	let fd;
	let fileNameSymlink = 'symlinkFile.txt';
	let fullPathToFile = baseDirPath + siteDirPath + '/' + fileName;
	let fullPathToFile2 = baseDirPath + '/sites2/a/b/c/abc-sitename/' + fileName;
	
	uSync.on('ready', function () {
		console.log('uSync ready');
	});
	
	it('mkdirp', function (done) {
		uSync.fs.mkdirp(baseDirPath + siteDirPath, err => {
			assert.ifError(err);
			done();
		});
	});
	
	it('writeFile', function (done) {
		uSync.fs.writeFile(fullPathToFile, 'example text...', err => {
			assert.ifError(err);
			done();
		});
	});
	
	it('close', function (done) {
		uSync.fs.open(fullPathToFile, 'w', (err, _fd) => {
			fd = _fd;
			assert.ifError(err);
			
			uSync.fs.close(fd, err => {
				assert.ifError(err);
				done();
			});
		});
	});
	
	it('symlink', function (done) {
		uSync.fs.writeFile(fullPathToFile, 'example text...', err => {
			assert.ifError(err);
			uSync.fs.symlink(fullPathToFile, baseDirPath + siteDirPath + '/' + fileNameSymlink, err => {
				assert.ifError(err);
				done();
			});
		});
	});
	
	// it('symlink check if not supported path', function (done) {
	// 	uSync.fs.symlink(fullPathToFile2, baseDirPath + siteDirPath + '/' + fileNameSymlink, err => {
	// 		console.log(err);
	// 		if (err && err instanceof uSync.exceptions.NotSupportedPathSymlink) {
	// 			assert.ok(1);
	// 		} else {
	// 			assert.ok(false);
	// 		}
	// 		done();
	// 	});
	// });
	
	
	it('unlink', function (done) {
		uSync.fs.unlink(fullPathToFile, err => {
			assert.ifError(err);
			done();
		});
	});
	
	it('rimraf', function (done) {
		
		uSync.fs.rimraf(baseDirPath, err => {
			assert.ifError(err);
			
			fs.access(baseDirPath, fs.R_OK | fs.W_OK, (err) => {
				if (err) {
					assert.ok(1);
				} else {
					assert.ok(false);
				}
				done();
			});
			
		});
	});
	
	
});


describe('Test transmitter', function () {
	
	it('create and connect to rabbitmq', function (done) {
		const transmitter = require('usync/transmitter')(config);
		transmitter.debug = (message) => {
			console.log(message);
		};
		
		transmitter.on('error', err => {
			console.log(err);
		});
		transmitter.on('connected', () => {
			done();
		});
	});
	
});


describe('Test receiver', function () {
	
	it('create', function (done) {
		const receiver = require('usync/receiver')(config);
		receiver.debug = (message) => {
			console.log(message);
		};
		
		receiver.on('error', err => {
			console.log(err);
		});
		
		receiver.on('task', task => {
			console.log(task);
		});
		
		receiver.on('ready', () => {
			done();
		});
		
	});
	
});
