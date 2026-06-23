import { PageHeader } from '../../shell/PageHeader'
import { PageBody } from '../../shell/PageBody'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { TagsTab } from './TagsTab'

export function Taxonomies() {
  return (
    <section className="taxonomies-screen">
      <PageHeader
        title="Taxonomies"
        subtitle="Organize how content is grouped and tagged."
      />
      <PageBody>
        <Tabs defaultValue="categories">
          <TabsList>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
          </TabsList>
          <TabsContent value="categories" className="mt-6">
            <div>Categories</div>
          </TabsContent>
          <TabsContent value="tags" className="mt-6">
            <TagsTab />
          </TabsContent>
        </Tabs>
      </PageBody>
    </section>
  )
}
