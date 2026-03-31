const log = (level, module, msg, data) => {
	const ts = new Date().toISOString().slice(11, 23);
	const prefix = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' }[level] || '';
	console.log(`${prefix}[${ts}] [${module}] ${msg}\x1b[0m`, data !== undefined ? data : '');
};

module.exports = {
	info: (mod, msg, data) => log('info', mod, msg, data),
	warn: (mod, msg, data) => log('warn', mod, msg, data),
	error: (mod, msg, data) => log('error', mod, msg, data),
	debug: (mod, msg, data) => log('debug', mod, msg, data),
};
