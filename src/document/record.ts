export function readRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        throw new RangeError('A document record must be an object.')
    }

    if (Array.isArray(value)) {
        throw new RangeError('A document record cannot be an array.')
    }

    return value as Record<string, unknown>
}

export function readText(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RangeError(`${name} must be a nonempty string.`)
    }

    return value
}

export function readBoolean(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') {
        throw new RangeError(`${name} must be a boolean.`)
    }

    return value
}

export function readNumber(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RangeError(`${name} must be a finite number.`)
    }

    return value
}
