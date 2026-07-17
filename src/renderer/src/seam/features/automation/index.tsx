import { AutomationDashboard } from './AutomationDashboard.js'

/**
 * EXT-SEAM: Automation domain renderer feature.
 */

export const automationRendererFeature = {
  id: 'automation',

  panels: [
    {
      id: 'automation-dashboard',
      title: 'Automation',
      component: AutomationDashboard
    }
  ],

  routes: [
    {
      path: '/automation',
      element: AutomationDashboard
    }
  ]
}
