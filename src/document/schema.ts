import { type Curve } from '../geometry/curve'
import { type ModelTolerance } from '../geometry/tolerance'
import {
    type DocumentId,
    type EntityId,
    type LayerId,
    type SourceId,
} from './id'
import {
    type AciColor,
    type EntityColor,
    type EntityLineweight,
    type LayerLineweight,
    type Linetype,
    type LineweightValue,
} from './properties'
import { type DrawingUnits } from './units'

export const DOCUMENT_SCHEMA_VERSION = 1

export type SourceFormat = 'dxf' | 'dwg'

export interface SourceFile {
    readonly id: SourceId
    readonly format: SourceFormat
    readonly fileName: string
    readonly version?: string
}

export interface EntitySource {
    readonly sourceId: SourceId
    readonly handle?: string
}

export interface EntityProperties {
    readonly layerId: LayerId
    readonly color: EntityColor
    readonly lineweight: EntityLineweight
    readonly linetype: Linetype
}

export interface Entity extends EntityProperties {
    readonly id: EntityId
    readonly geometry: Curve
    readonly source?: EntitySource
}

export interface Layer {
    readonly id: LayerId
    readonly name: string
    readonly color: AciColor
    readonly visible: boolean
    readonly frozen: boolean
    readonly locked: boolean
    readonly lineweight: LayerLineweight
    readonly linetype: Extract<Linetype, 'continuous'>
}

export interface DrawingDocument {
    readonly schemaVersion: typeof DOCUMENT_SCHEMA_VERSION
    readonly id: DocumentId
    readonly revision: number
    readonly units: DrawingUnits
    readonly modelTolerance: ModelTolerance
    readonly defaultLineweight: LineweightValue
    readonly defaults: EntityProperties
    readonly layers: readonly Layer[]
    readonly entities: readonly Entity[]
    readonly sources: readonly SourceFile[]
}
