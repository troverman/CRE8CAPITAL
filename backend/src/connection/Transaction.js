const Transaction = {
	string: 'Transaction',
	protocol: async (data) => {
		return { ...data, type: 'transaction' };
	}
};

module.exports = Transaction;
