import type { BlockControl } from '@setu/core'
import type { ControlProps } from './types'
import { TextControl, UrlControl, NumberControl } from './text'
import { TextareaControl } from './textarea'
import { SwitchControl } from './switch'
import { SelectControl } from './select'
import { ColorControl } from './color'
import { MediaControl } from './media'

export const controlRegistry: Record<BlockControl, React.FC<ControlProps>> = {
  text: TextControl,
  url: UrlControl,
  number: NumberControl,
  textarea: TextareaControl,
  switch: SwitchControl,
  select: SelectControl,
  color: ColorControl,
  media: MediaControl,
  // position9 + align registered in Tasks 4 & 5:
  position9: SelectControl,
  align: SelectControl,
}
