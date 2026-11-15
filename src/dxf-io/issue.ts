export type DxfIssueKind = 'converted' | 'unsupported'

export interface DxfIssue {
    readonly kind: DxfIssueKind
    readonly code: number
    readonly line: number
    readonly message: string
}
