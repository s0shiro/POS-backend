import type { ParamsDictionary } from 'express-serve-static-core'
import type { ParsedQs } from 'qs'
import type { AuthenticatedRequest } from '../middleware/requireAuth.ts'

export interface TypedRequest<
  TBody = object,
  TParams extends ParamsDictionary = ParamsDictionary,
  TQuery extends ParsedQs = ParsedQs,
> extends AuthenticatedRequest<TParams, TBody> {
  query: TQuery
}
