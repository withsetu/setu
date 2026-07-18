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
import { useNotify } from '../ui/notify'

export function GlobalCommands() {
  const navigate = useNavigate()
  const { rebuild, status: deployStatus } = useDeploy()
  const can = useCan()
  const notify = useNotify()

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
      run: () => {
        notify.success('Rebuild started')
        void rebuild()
          .then(() => notify.success('Site rebuilt — changes are live'))
          .catch((e) =>
            notify.error(e instanceof Error ? e.message : String(e))
          )
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
