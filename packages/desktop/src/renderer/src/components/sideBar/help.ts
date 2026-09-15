import {
  Folder as FilesIcon,
  Document as FileActionsIcon,
  Search as SearchIcon,
  Memo as TocIcon,
  Setting as SettingIcon
} from '@element-plus/icons-vue'
import { t } from '@/i18n'

export interface SideBarIconEntry {
  id: string
  name: () => string
  icon: unknown
}

/** Not a layout column: clicking this entry opens the file-actions overlay
 *  instead of swapping the right panel (see `openSideBarFileMenu`). */
export const FILE_ACTIONS_ICON_ID = 'fileActions'

export const sideBarIcons: SideBarIconEntry[] = [
  {
    id: FILE_ACTIONS_ICON_ID,
    name: () => t('menu.file.file'),
    icon: FileActionsIcon
  },
  {
    id: 'files',
    name: () => t('sideBar.icons.files'),
    icon: FilesIcon
  },
  {
    id: 'search',
    name: () => t('sideBar.icons.search'),
    icon: SearchIcon
  },
  {
    id: 'toc',
    name: () => t('sideBar.icons.toc'),
    icon: TocIcon
  }
]

export const sideBarBottomIcons: SideBarIconEntry[] = [
  {
    id: 'settings',
    name: () => t('sideBar.icons.settings'),
    icon: SettingIcon
  }
]
