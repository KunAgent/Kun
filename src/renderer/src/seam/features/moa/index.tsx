import { MoaPresets } from './MoaPresets.js'

export const moaRendererFeature = {
  id: 'moa',
  panels: [{ id: 'moa-presets', title: 'MoA', component: MoaPresets }],
  routes: [{ path: '/moa', element: MoaPresets }]
}
