'use strict';

const Receiver = require('./lib/receiver/http');

module.exports = (config) => {
	return new Receiver(config);
};
