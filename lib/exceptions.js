'use strict';

class ErrorUSync extends Error {
	constructor(message) {
		super(message);
	}
}

class ErrorDeprecatedSyncFunctions extends ErrorUSync {
	constructor(functionName) {
		super(`Function "${functionName}" is deprecated in project`);
	}
}

class ErrorRBMQ extends ErrorUSync {
	constructor(message) {
		super(message);
	}
}

class ErrorTask extends ErrorUSync {
	constructor(task, message) {
		super(message);
		
		this.task = JSON.stringify({
			queueName: task.queueName,
			timeDelay: task.timeDelay,
			message  : {
				subject : task.message.subject,
				command : task.message.command,
				stats   : task.message.stats,
				receiver: task.message.receiver,
				path    : task.message.path
			}
		});
	}
}

class NotSupportedPathSymlink extends ErrorTask {
	constructor(task, path) {
		super(task, `Not supported path: "${path}" with symlink`);
	}
}

class ErrorTransmitter extends ErrorUSync {
	constructor(message) {
		super(message);
	}
}

class ErrorReceiver extends ErrorUSync {
	constructor(message) {
		super(message);
	}
}

class ErrorReceiverProcess extends ErrorReceiver {
	constructor(message, fields) {
		super(message);
		this.fields = fields;
	}
}

class ErrorDecorator extends ErrorUSync {
	constructor(message) {
		super(message);
	}
}

module.exports = {
	ErrorUSync             : ErrorUSync,
	DeprecatedSyncFunctions: ErrorDeprecatedSyncFunctions,
	NotSupportedPathSymlink: NotSupportedPathSymlink,
	ErrorTask              : ErrorTask,
	ErrorRBMQ              : ErrorRBMQ,
	ErrorTransmitter       : ErrorTransmitter,
	ErrorReceiver          : ErrorReceiver,
	ErrorReceiverProcess   : ErrorReceiverProcess,
	ErrorDecorator         : ErrorDecorator,
};
