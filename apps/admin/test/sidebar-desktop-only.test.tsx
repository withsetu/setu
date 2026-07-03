import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  SidebarProvider,
  Sidebar,
  SidebarContent
} from '@/components/ui/sidebar'

describe('sidebar is desktop-only', () => {
  it('never renders a mobile dialog/sheet', () => {
    const { queryByRole } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>nav</SidebarContent>
        </Sidebar>
      </SidebarProvider>
    )
    expect(queryByRole('dialog')).toBeNull()
  })
})
