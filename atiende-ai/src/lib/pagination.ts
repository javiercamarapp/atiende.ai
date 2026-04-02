export interface PaginationParams {
  page: number
  pageSize: number
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Convert page/pageSize into a zero-based { from, to } range
 * suitable for Supabase `.range(from, to)`.
 */
export function getPaginationRange(params: PaginationParams): { from: number; to: number } {
  const page = Math.max(1, params.page)
  const pageSize = Math.max(1, params.pageSize)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  return { from, to }
}

/**
 * Build a PaginatedResult from a data array and total count.
 */
export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  params: PaginationParams,
): PaginatedResult<T> {
  const pageSize = Math.max(1, params.pageSize)
  return {
    data,
    total,
    page: Math.max(1, params.page),
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}
