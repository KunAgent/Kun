import { ExpertsPlaza } from './ExpertsPlaza.js'

/**
 * EXT-SEAM: Experts domain renderer feature.
 *
 * Exports panel components and route configuration for the Experts domain.
 */

export const expertsRendererFeature = {
  id: 'experts',

  panels: [
    {
      id: 'experts-plaza',
      title: 'Experts Plaza',
      component: ExpertsPlaza
    }
  ],

  routes: [
    {
      path: '/experts',
      element: ExpertsPlaza
    }
  ]
}
