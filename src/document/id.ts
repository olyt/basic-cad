export const ID_KINDS = ['document', 'entity', 'layer', 'source'] as const
export type IdKind = (typeof ID_KINDS)[number]

declare const idBrand: unique symbol

export type ApplicationId<Kind extends IdKind> = string & {
    readonly [idBrand]: Kind
}
export type DocumentId = ApplicationId<'document'>
export type EntityId = ApplicationId<'entity'>
export type LayerId = ApplicationId<'layer'>
export type SourceId = ApplicationId<'source'>

export interface IdState {
    readonly namespace: string
    readonly nextSequence: number
}

const idKinds: ReadonlySet<unknown> = new Set(ID_KINDS)

export function isIdKind(value: unknown): value is IdKind {
    return idKinds.has(value)
}

function checkedSequence(nextSequence: number): number {
    const validSequence =
        Number.isSafeInteger(nextSequence) && nextSequence >= 0

    if (!validSequence) {
        throw new RangeError('ID sequence must be a nonnegative safe integer.')
    }

    return nextSequence
}

export function createIdState(
    namespace: string,
    nextSequence: number,
): IdState {
    if (typeof namespace !== 'string' || !/^[A-Za-z0-9_-]+$/.test(namespace)) {
        throw new RangeError(
            'ID namespace must contain only ASCII letters, digits, hyphens or underscores.',
        )
    }

    return { namespace, nextSequence: checkedSequence(nextSequence) }
}

export function parseId<Kind extends IdKind>(
    kind: Kind,
    value: string,
): ApplicationId<Kind> {
    if (!isIdKind(kind) || typeof value !== 'string') {
        throw new RangeError(
            'Application ID needs a supported kind and string value.',
        )
    }

    const parts = value.split(':')

    if (parts.length !== 3 || parts[0] !== kind) {
        throw new RangeError('Application ID kind or structure is invalid.')
    }

    const sequence = Number.parseInt(parts[2]!, 36)
    const state = createIdState(parts[1]!, sequence)
    const canonical = parts[2] === state.nextSequence.toString(36)

    if (!canonical || sequence === Number.MAX_SAFE_INTEGER) {
        throw new RangeError(
            'Application ID sequence is not canonical or exceeds the allocation range.',
        )
    }

    return value as ApplicationId<Kind>
}

export function allocateId<Kind extends IdKind>(
    kind: Kind,
    state: IdState,
): { readonly id: ApplicationId<Kind>; readonly nextState: IdState } {
    if (!isIdKind(kind)) {
        throw new RangeError('Application ID kind is unsupported.')
    }

    const checked = createIdState(state.namespace, state.nextSequence)

    if (checked.nextSequence === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('Application ID sequence is exhausted.')
    }

    const id =
        `${kind}:${checked.namespace}:${checked.nextSequence.toString(36)}` as ApplicationId<Kind>

    return {
        id,
        nextState: {
            namespace: checked.namespace,
            nextSequence: checked.nextSequence + 1,
        },
    }
}
