const CapitalRuntime = require('./CapitalRuntime');

const runtime = new CapitalRuntime();

const createCapitalRuntime = (options) => new CapitalRuntime(options);

module.exports = {
	CapitalRuntime,
	runtime,
	createCapitalRuntime
};
