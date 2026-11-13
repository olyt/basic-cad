import { type TextCodec } from '../dxf-io/decode-bytes'

export const decodeText: TextCodec = (bytes, encoding) =>
    new TextDecoder(encoding, { fatal: true }).decode(bytes)
