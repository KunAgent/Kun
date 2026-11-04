// Overlay-only copy of the channel names. The sandboxed preload bundle cannot
// share a Rollup chunk with the workbench preload, so this file must stay
// independent of src/shared/pets.ts. The matching test keeps the strings aligned.
export const PET_OVERLAY_IPC = {
  overlayBootstrap: 'kun:pets:overlay:bootstrap',
  overlayBootstrapChanged: 'kun:pets:overlay:bootstrap-changed',
  overlayActivity: 'kun:pets:overlay:activity',
  overlayFocused: 'kun:pets:overlay:main-focused',
  overlayDragStart: 'kun:pets:overlay:drag-start',
  overlayDragMove: 'kun:pets:overlay:drag-move',
  overlayDragEnd: 'kun:pets:overlay:drag-end',
  overlayDragCancel: 'kun:pets:overlay:drag-cancel',
  overlayPointer: 'kun:pets:overlay:pointer',
  overlayResize: 'kun:pets:overlay:resize',
  overlayResizeEnd: 'kun:pets:overlay:resize-end',
  overlayBounds: 'kun:pets:overlay:bounds',
  overlayAction: 'kun:pets:overlay:action',
  overlayDismiss: 'kun:pets:overlay:dismiss',
  overlayWelcomed: 'kun:pets:overlay:welcomed',
  overlayOpenMain: 'kun:pets:overlay:open-main',
  overlayOpenSettings: 'kun:pets:overlay:open-settings',
  overlayClose: 'kun:pets:overlay:close',
  overlayChat: 'kun:pets:overlay:chat',
  overlayVoiceAvailable: 'kun:pets:overlay:voice-available',
  overlayBubblesCollapsed: 'kun:pets:overlay:bubbles-collapsed'
} as const
