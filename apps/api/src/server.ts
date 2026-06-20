import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { createGitApi } from './app'
import { createPreviewApi } from './preview'
import { createUploadApi } from './media'
import { resolveLocalOwner } from './auth/resolve-actor'

const dir = process.env.SETU_REPO_DIR ?? process.cwd()
const port = Number(process.env.SETU_API_PORT ?? 4444)
const mediaDir = process.env.SETU_MEDIA_DIR ?? `${dir}/.setu/uploads`
const mediaPublicUrl = process.env.SETU_MEDIA_PUBLIC_URL ?? `http://localhost:${port}/media`
const imageFormat = process.env.SETU_IMAGE_FORMAT === 'avif' ? 'avif' : 'webp'

const app = new Hono()
app.route('/', createGitApi(createLocalGitAdapter({ dir })))
app.route('/', createPreviewApi())
app.route('/', createUploadApi({
  storage: createLocalStorage({ dir: mediaDir, baseUrl: mediaPublicUrl }),
  resolveActor: resolveLocalOwner,
  image: createSharpImageAdapter(),
  imageConfig: { format: imageFormat, widths: [400, 800, 1200, 1600] },
}))

serve({ fetch: app.fetch, port })
console.log(`api listening on http://localhost:${port} (repo: ${dir}, media: ${mediaDir}, image: ${imageFormat})`)
