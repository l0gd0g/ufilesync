'use strict';
const USync = require('./lib/usync');

module.exports = (config) => {
	return new USync(config);
};
