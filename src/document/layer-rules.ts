import { type LayerId } from './id'
import { type DrawingDocument, type Entity } from './schema'

interface LayerEdit {
    readonly next: DrawingDocument
    readonly changedEntityIds: ReadonlySet<string>
}

function assertZeroLayer(
    current: DrawingDocument,
    next: DrawingDocument,
): void {
    const original = current.layers.find((layer) => layer.name === '0')
    const retained = next.layers.find((layer) => layer.id === original?.id)

    if (retained?.name !== '0') {
        throw new RangeError('Layer 0 cannot be renamed or deleted.')
    }
}

function isLocked(
    entity: Entity | undefined,
    lockedLayers: ReadonlySet<LayerId>,
): boolean {
    return entity !== undefined && lockedLayers.has(entity.layerId)
}

export function assertLayerEdits(
    current: DrawingDocument,
    edit: LayerEdit,
): void {
    const { next, changedEntityIds } = edit

    assertZeroLayer(current, next)

    if (changedEntityIds.size === 0) {
        return
    }

    const lockedLayers = new Set(
        [...current.layers, ...next.layers]
            .filter((layer) => layer.locked)
            .map((layer) => layer.id),
    )
    const before = new Map<string, Entity>(
        current.entities.map((entity) => [entity.id, entity]),
    )
    const after = new Map<string, Entity>(
        next.entities.map((entity) => [entity.id, entity]),
    )

    for (const id of changedEntityIds) {
        const locked =
            isLocked(before.get(id), lockedLayers) ||
            isLocked(after.get(id), lockedLayers)

        if (locked) {
            throw new RangeError('Entities on locked layers cannot be edited.')
        }
    }
}
