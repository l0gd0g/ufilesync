'use strict';
const Transmitter = require('./lib/transmitter/http');

module.exports = (config, processedLetters) => {
	return new Transmitter(config, processedLetters);
};
