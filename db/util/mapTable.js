// helper that that takes a db driver and transform the table name through some
// arbitrary function. Useful to CI.

export default (driver, map) => {
	const out = (table, queryDesc) => {
		return driver(map(table), queryDesc);
	};

	Object.assign(out, driver);
	return out;
};
