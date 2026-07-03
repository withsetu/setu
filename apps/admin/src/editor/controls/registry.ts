import type { BlockControl } from '@setu/core'
import type { ControlProps } from './types'
import { TextControl, UrlControl, NumberControl } from './text'
import { TextareaControl } from './textarea'
import { SwitchControl } from './switch'
import { SelectControl } from './select'
import { SegmentedSelect } from './segmented-select'
import { ColorControl } from './color'
import { MediaControl } from './media'
import { Position9 } from './position9'
import { AlignControl } from './align'
import { SliderControl } from './slider'
import { CategoryControl } from './category'
import { TagControl } from './tag'

export const controlRegistry: Record<BlockControl, React.FC<ControlProps>> = {
  text: TextControl,
  url: UrlControl,
  number: NumberControl,
  textarea: TextareaControl,
  switch: SwitchControl,
  select: SegmentedSelect,
  color: ColorControl,
  media: MediaControl,
  position9: Position9,
  align: AlignControl,
  slider: SliderControl,
  category: CategoryControl,
  tag: TagControl
}
