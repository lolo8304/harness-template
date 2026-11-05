export type ErrorCode = "VALIDATION" | "AUTH" | "NETWORK" | "API" | "INTERNAL";

export class AppError extends Error {
    constructor(
        public code: ErrorCode,
        message: string,
        public status?: number,
    ) {
        super(message);
    }
}

export const exitCodes: Record<ErrorCode, number> = {
    VALIDATION: 2,
    AUTH: 3,
    NETWORK: 4,
    API: 5,
    INTERNAL: 1,
};

export function errorBody(error: unknown) {
    const e =
        error instanceof AppError
            ? error
            : new AppError("INTERNAL", "Unexpected internal error");
    return {
        error: {
            code: e.code,
            message: e.message,
            ...(e.status ? {status: e.status} : {}),
        },
    };
}
