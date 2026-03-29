const Exchange = {
	string: 'Exchange',
	protocol: async (data) => {
		return { ...data, type: 'exchange' };
	}
};

module.exports = Exchange;
