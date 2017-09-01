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

class ErrorCreateTask extends ErrorUSync {
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
				subject : task.subject,
				command : task.command,
				stats   : task.stats,
				receiver: task.receiver,
				path    : task.path
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

class TimeoutPublishMesssage extends ErrorTask {
	constructor(task, timeOutPushMessage) {
		super(task, `Time out(${timeOutPushMessage}) publish message`);
	}
}


module.exports = {
	ErrorUSync             : ErrorUSync,
	DeprecatedSyncFunctions: ErrorDeprecatedSyncFunctions,
	NotSupportedPathSymlink: NotSupportedPathSymlink,
	ErrorCreateTask        : ErrorCreateTask,
	ErrorTask              : ErrorTask,
	ErrorRBMQ              : ErrorRBMQ,
	ErrorTransmitter       : ErrorTransmitter,
	ErrorReceiver          : ErrorReceiver,
	ErrorReceiverProcess   : ErrorReceiverProcess,
	ErrorDecorator         : ErrorDecorator,
	TimeoutPublishMesssage : TimeoutPublishMesssage,
};
