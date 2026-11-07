import { type ModelTolerance } from '../geometry/tolerance'
import { admitCurve } from './geometry-admission'
import { parseId } from './id'
import { readRecord, readText } from './record'
import { admitEntityProperties, admitEntitySource } from './record-admission'
import { type Entity } from './schema'

export function admitEntity(
    value: unknown,
    modelTolerance: ModelTolerance,
): Entity {
    const { id, geometry, source, layerId, color, lineweight, linetype } =
        readRecord(value)

    return {
        id: parseId('entity', readText(id, 'Entity ID')),
        geometry: admitCurve(geometry, modelTolerance),
        ...admitEntityProperties({ layerId, color, lineweight, linetype }),
        ...(source === undefined ? {} : { source: admitEntitySource(source) }),
    }
}
