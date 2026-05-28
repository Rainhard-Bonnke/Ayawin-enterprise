function parsePagination(query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 200);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function parseSort(query, allowed, defaultSort = 'created_at') {
  const sort = typeof query.sort === 'string' && allowed.includes(query.sort) ? query.sort : defaultSort;
  const order = query.order === 'asc' ? 'ASC' : 'DESC';
  return { sort, order };
}

module.exports = { parsePagination, parseSort };
