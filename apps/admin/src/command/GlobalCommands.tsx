import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  Files,
  Folders,
  Image,
  Palette,
  Settings,
  Plus,
  Rocket,
  SunMoon
} from 'lucide-react'
import { useRegisterCommands, type CommandAction } from './registry'
import { toggleTheme } from '../shell/theme'
import { useDeploy } from '../deploy/deploy'
import { useCan } from '../auth/actor'

export function GlobalCommands() {
  const navigate = useNavigate()
  const { requestRebuild, status: deployStatus } = useDeploy()
  const can = useCan()

  const actions: CommandAction[] = [
    {
      id: 'create.post',
      title: 'New post',
      group: 'Create',
      icon: Plus,
      run: () => {
        void navigate('/edit/post/en/new')
      }
    },
    {
      id: 'create.page',
      title: 'New page',
      group: 'Create',
      icon: Plus,
      run: () => {
        void navigate('/edit/page/en/new')
      }
    },
    {
      id: 'nav.dashboard',
      title: 'Dashboard',
      group: 'Go to',
      icon: LayoutDashboard,
      run: () => {
        void navigate('/dashboard')
      }
    },
    {
      id: 'nav.posts',
      title: 'Posts',
      group: 'Go to',
      icon: FileText,
      run: () => {
        void navigate('/posts')
      }
    },
    {
      id: 'nav.pages',
      title: 'Pages',
      group: 'Go to',
      icon: Files,
      run: () => {
        void navigate('/pages')
      }
    },
    {
      id: 'nav.taxonomies',
      title: 'Taxonomies',
      group: 'Go to',
      icon: Folders,
      keywords: 'categories tags',
      run: () => {
        void navigate('/taxonomies')
      }
    },
    {
      id: 'nav.media',
      title: 'Media',
      group: 'Go to',
      icon: Image,
      run: () => {
        void navigate('/media')
      }
    },
    {
      id: 'nav.appearance',
      title: 'Appearance',
      group: 'Go to',
      icon: Palette,
      run: () => {
        void navigate('/appearance')
      }
    },
    {
      id: 'nav.settings',
      title: 'Settings',
      group: 'Go to',
      icon: Settings,
      run: () => {
        void navigate('/settings')
      }
    },
    {
      id: 'site.deploy',
      title: 'Publish site (rebuild)',
      group: 'Site',
      icon: Rocket,
      enabled: () => can('site.deploy') && deployStatus?.canRebuild === true,
      // #571: the palette asks the same confirmation the sidebar control does — a
      // deploy is outward and costly, so no entry point starts one unconfirmed. The
      // dialog (and its progress/outcome reporting) lives in DeployControl.
      run: () => {
        requestRebuild()
      }
    },
    {
      id: 'site.theme',
      title: 'Toggle theme',
      group: 'Site',
      icon: SunMoon,
      keywords: 'dark light mode',
      run: () => {
        toggleTheme()
      }
    }
  ]

  useRegisterCommands(actions)
  return null
}
