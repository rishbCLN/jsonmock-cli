// Pure query helpers: filter, sort and paginate an array of records using URL
// query parameters. No I/O — this is the most-tested "read path" of the db.
//
// Special params: _page, _limit, _sort, _order. Everything else is a filter.
// Filter operators are expressed as key suffixes, e.g. views_gte=100.

const OPERATORS = ['_gte', '_lte', '_gt', '_lt', '_ne', '_like'];

/** Coerce a value to a number when it clearly looks numeric, else leave as-is. */
function coerce(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const s = String(value);
  if (s.trim() !== '' && !Number.isNaN(Number(s))) return Number(s);
  return s;
}

/** Order-comparison that prefers numeric comparison, falling back to strings. */
export function compareValues(a, b) {
  const ca = coerce(a);
  const cb = coerce(b);
  if (typeof ca === 'number' && typeof cb === 'number') {
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  }
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function matchesFilter(item, field, op, value) {
  const actual = item == null ? undefined : item[field];
  switch (op) {
    case 'ne':
      return String(actual) !== String(value);
    case 'like':
      try {
        return new RegExp(String(value), 'i').test(String(actual ?? ''));
      } catch {
        return false;
      }
    case 'gte':
      return compareValues(actual, value) >= 0;
    case 'lte':
      return compareValues(actual, value) <= 0;
    case 'gt':
      return compareValues(actual, value) > 0;
    case 'lt':
      return compareValues(actual, value) < 0;
    case 'eq':
    default:
      return String(actual) === String(value) || compareValues(actual, value) === 0;
  }
}

/**
 * Filter an array of records by the non-special query params.
 * @param {object[]} items
 * @param {Record<string,string>} params
 */
export function applyFilters(items, params = {}) {
  const filters = [];
  for (const rawKey of Object.keys(params)) {
    if (rawKey.startsWith('_')) continue; // reserved / special param
    let field = rawKey;
    let op = 'eq';
    for (const suffix of OPERATORS) {
      if (rawKey.length > suffix.length && rawKey.endsWith(suffix)) {
        field = rawKey.slice(0, -suffix.length);
        op = suffix.slice(1);
        break;
      }
    }
    filters.push({ field, op, value: params[rawKey] });
  }
  if (filters.length === 0) return items;
  return items.filter((item) => filters.every((f) => matchesFilter(item, f.field, f.op, f.value)));
}

/**
 * Stable sort by a single field.
 * @param {object[]} items
 * @param {string} sortKey
 * @param {string} [order] "asc" (default) or "desc"
 */
export function sortItems(items, sortKey, order = 'asc') {
  if (!sortKey) return items;
  const dir = String(order).toLowerCase() === 'desc' ? -1 : 1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const c = compareValues(a.item == null ? undefined : a.item[sortKey], b.item == null ? undefined : b.item[sortKey]);
      return c !== 0 ? c * dir : a.index - b.index;
    })
    .map((d) => d.item);
}

/**
 * Slice a page out of an array.
 * @returns {{ items: object[], total: number, page: number, limit: number }}
 */
export function paginate(items, page, limit) {
  const total = items.length;
  const p = Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1);
  const l = Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : 0);
  const start = (p - 1) * l;
  return { items: items.slice(start, start + l), total, page: p, limit: l };
}

/**
 * Full read pipeline: filter -> sort -> paginate.
 * @param {object[]} items
 * @param {Record<string,string>} [params]
 * @returns {{ items: object[], total: number, page?: number, limit?: number, paginated: boolean }}
 */
export function queryCollection(items, params = {}) {
  let out = applyFilters(Array.isArray(items) ? items : [], params);
  const total = out.length; // count after filtering, before pagination

  if (params._sort) {
    out = sortItems(out, params._sort, params._order);
  }

  const hasPage = params._page != null;
  const hasLimit = params._limit != null;
  if (hasPage || hasLimit) {
    const page = hasPage ? (parseInt(params._page, 10) || 1) : 1;
    const rawLimit = parseInt(params._limit, 10);
    const limit = hasLimit ? (Number.isFinite(rawLimit) ? Math.max(0, rawLimit) : 10) : 10;
    const res = paginate(out, page, limit);
    return { items: res.items, total, page: res.page, limit: res.limit, paginated: true };
  }

  return { items: out, total, paginated: false };
}
