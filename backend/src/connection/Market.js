const Market = {
	string: 'Market',
	protocol: async (data) => {
		const parts = (data.string || '').replace('-', '/').split('/');
		return { ...data, base: parts[0], quote: parts[1], type: 'market' };
	}
};

module.exports = Market;
