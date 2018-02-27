'use strict';

module.exports = {
	rabbitmq: {
		exchange: '',
		
		connectionConfig: {
			protocol : 'amqp',
			hostname : 'localhost',
			port     : 5672,
			username : 'guest',
			password : 'guest',
			locale   : 'en_US',
			frameMax : 0,
			heartbeat: 0,
		},
		queueConfig     : {
			autoDelete: false,
			durable   : true
		}
	},
	
	processedLetters: '-_abcdefghijklmnopqrstuvwxyz0123456789',
	fileSendMethods : ['write', 'writeFile', 'createWriteStream', 'rename', 'move', 'copy', 'copyFile'],
	domainName   : 'domain.ru',
	port         : 1234,
	pathToStorage: 'usync_storage/reserve',
	timeReconnect: 200,
	prefetchCount: 1,
	queuePrefix  : 'sync_reserve'
};