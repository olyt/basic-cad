import { expect, it } from 'vitest'
import { createArc } from '../geometry/curve'
import { allocateId, createIdState, parseId } from './id'
import { createAciColor } from './properties'
import { type Entity, type Layer, type SourceFile } from './schema'

it('keeps analytic geometry, Unicode layer names and diagnostic source handles separate from identity', () => {
    const sourceId = allocateId('source', createIdState('original-file', 0))
    const layerId = allocateId('layer', sourceId.nextState)
    const entityId = allocateId('entity', layerId.nextState)
    const source: SourceFile = {
        id: sourceId.id,
        format: 'dxf',
        fileName: 'План.dxf',
        version: 'AC1015',
    }
    const layer: Layer = {
        id: layerId.id,
        name: 'Контур',
        color: createAciColor(3),
        visible: true,
        frozen: true,
        locked: false,
        lineweight: 25,
        linetype: 'continuous',
    }
    const geometry = createArc({
        center: { x: 1, y: 2 },
        radius: 3,
        startAngle: 0.7,
        sweep: -1.2,
    })
    const entity: Entity = {
        id: entityId.id,
        geometry,
        layerId: layer.id,
        color: 'by-layer',
        lineweight: 'default',
        linetype: 'continuous',
        source: { sourceId: source.id, handle: 'AA' },
    }
    const json = JSON.parse(JSON.stringify({ entity, layer, source }))

    expect(json.entity.geometry).toEqual(geometry)
    expect(json.layer.name).toBe('Контур')
    expect(json.entity.source.handle).toBe('AA')
    expect(json.entity.source.sourceId).toBe(json.source.id)
    expect(parseId('entity', json.entity.id)).toBe(entityId.id)
    expect(entity.id).not.toBe(entity.source!.handle)
})
