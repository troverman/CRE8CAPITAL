const Position = {
	string: 'Position',
	protocol: async (data) => {
		return { ...data, type: 'position' };
	}
};

module.exports = Position;
