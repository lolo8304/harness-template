export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
}

export interface Pagination {
    page: number;
    limit: number;
}

export function paginate<T>(items: T[], search: Pagination): Page<T> {
    return {
        items: items.slice(
            (search.page - 1) * search.limit,
            search.page * search.limit,
        ),
        total: items.length,
        page: search.page,
        limit: search.limit,
    };
}
