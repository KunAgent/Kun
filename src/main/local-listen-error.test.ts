import { describe, expect, it } from 'vitest'
import { describeLocalListenError } from './local-listen-error'

describe('describeLocalListenError', () => {
  it('names the port and the setting that moves it when the port is taken', () => {
    const taken = Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:18788'), { code: 'EADDRINUSE' })
    expect(describeLocalListenError(taken, 18788, 'Settings > Schedule')).toEqual({
      message: '127.0.0.1:18788 is already in use, by another Kun instance or another program. Choose a free port in Settings > Schedule.',
      code: 'EADDRINUSE',
      port: 18788
    })
  })

  it('keeps any other failure as it was, with its code', () => {
    const denied = Object.assign(new Error('listen EACCES: permission denied'), { code: 'EACCES' })
    expect(describeLocalListenError(denied, 80, 'Settings > IM')).toEqual({ message: 'listen EACCES: permission denied', code: 'EACCES', port: 80 })
    expect(describeLocalListenError('boom', 1, 'x')).toEqual({ message: 'boom', port: 1 })
  })
})
