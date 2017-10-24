'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
let baseDirModule = '/home/lprojects/ulight/ulight8/node_modules/usync';
let baseDirPath = 'test_tmp';

const config = {
	exchange          : '',
	isRunSync         : true,
	isRunDebugMode    : false,
	debugCommands: ['copy', 'unlink', 'symlink'],
	baseDir           : baseDirModule,
	queueNameSyncFiles: 'syncTest',
	watchDirs         : [baseDirPath + '/sites', baseDirPath + '/sites2'],
	
	rabbitmq          : {
		host         : 'localhost',
		port         : 5672,
		login        : 'guest',
		password     : 'guest',
		prefetchCount: 1,
	},
	
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

const UFileSync = require('..');
const uSync = new UFileSync.synchronisation(config);

// describe('Test uSync', function () {
//
// 	it('getPathInStorage', function () {
// 		let path = uSync.getPathInStorage('test_tmp/sites/r/c/g/rcgljadcc6yb/index.html');
// 		assert.equal(path, 'test_tmp/sites/r/c/g/rcgljadcc6yb%2Findex.html');
// 	});
// });


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
	let fullPathToFileRelative = './' + baseDirPath + siteDirPath + '/' + fileName + '_2';
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
	
	it('copy file', function (done) {
		let fileName = fullPathToFile + '_copy';
		uSync.fs.copy(fullPathToFile, fileName, err => {
			assert.ifError(err);
			done();
		});
	});
	
	it('copy file with relative path "./"', function (done) {
		let fileNameSrc = '/tmp/testfile.tmp_123';
		let fileNameDest = fullPathToFileRelative;
		
		uSync.fs.writeFile(fileNameSrc, 'example text...', err => {
			assert.ifError(err);
			
			uSync.fs.copy(fileNameSrc, fileNameDest, err => {
				assert.ifError(err);
				done();
			});
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
		let fileNameSrc = fullPathToFile + '_symlink';
		uSync.fs.writeFile(fileNameSrc, 'example text...', err => {
			assert.ifError(err);
			uSync.fs.symlink(fileNameSrc, baseDirPath + siteDirPath + '/' + fileNameSymlink, err => {
				assert.ifError(err);
				done();
			});
		});
	});
	
	
	
	it('copy dir', function (done) {
		uSync.fs.copy(baseDirPath + siteDirPath, baseDirPath + siteDirPath + '_copy', err => {
			assert.ifError(err);
			done();
		});
	});
	
	it('copy dir with option replace', function (done) {
		uSync.fs.copy(baseDirPath + siteDirPath, baseDirPath + siteDirPath + '_copy', {replace: true}, err => {
			assert.ifError(err);
			done();
		});
	});
	
	it('unlink', function (done) {
		uSync.fs.unlink(fullPathToFile, err => {
			assert.ifError(err);
			done();
		});
	});
	
	it('unlink with taskSkip()', function (done) {
		uSync.fs.unlink(uSync.taskSkip(), fullPathToFileRelative, err => {
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
		const transmitter =  require('../transmitter')(config);
		transmitter.debug = (message) => {
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
		const receiver = require('../receiver')(config);
		receiver.debug = (message) => {
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
