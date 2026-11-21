export type DxfIssueKind = 'converted' | 'unsupported'

export interface DxfIssue {
    readonly kind: DxfIssueKind
    readonly code: number
    readonly line: number
    readonly message: string
    // Zero-based LWPOLYLINE vertex; segment i starts at vertex i.
    readonly vertex?: number
}
