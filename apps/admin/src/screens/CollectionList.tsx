import { Navigate, useParams } from 'react-router-dom'
import { ContentList } from './ContentList'
import { useCollections } from '@/data/collections-store'
import { findCollection } from '@/data/collections'

/** Route element for `/content/:collection` — the zero-config list screen every DECLARED
 *  collection gets without hand-written routing (#253 increment C). `post` and `page` keep
 *  their own routes for URL stability; everything from setu.config lands here.
 *
 *  An unknown `:collection` redirects to the cross-collection list rather than rendering an
 *  empty table under a made-up heading. While the collection set is still loading we render
 *  nothing instead of redirecting — otherwise a direct visit to a valid URL would bounce
 *  before the answer arrived. */
export function CollectionList() {
  const { collection } = useParams<{ collection: string }>()
  const { collections, loading } = useCollections()
  const declared = findCollection(collections, collection)

  if (declared === undefined) {
    return loading ? null : <Navigate to="/content" replace />
  }
  return <ContentList collection={declared.name} title={declared.labelPlural} />
}
