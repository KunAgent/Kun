// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { OPEN_POPUP_TRIGGER_SELECTOR } from './use-floating-composer-actions'

describe('Esc-to-stop popup guard', () => {
  it('counts open popup triggers but not persistent disclosures', () => {
    const root = document.createElement('div')
    root.innerHTML = [
      '<button data-case="queue" aria-expanded="true" aria-controls="queue-list"></button>',
      '<button data-case="quote" aria-expanded="true"></button>',
      '<button data-case="closed-picker" aria-haspopup="listbox" aria-expanded="false"></button>',
      '<button data-case="no-popup" aria-haspopup="false" aria-expanded="true"></button>'
    ].join('')
    expect(root.querySelector(OPEN_POPUP_TRIGGER_SELECTOR)).toBeNull()

    root.insertAdjacentHTML('beforeend', '<button data-case="menu" aria-haspopup="menu" aria-expanded="true"></button>')
    expect(root.querySelector(OPEN_POPUP_TRIGGER_SELECTOR)?.getAttribute('data-case')).toBe('menu')
  })
})
