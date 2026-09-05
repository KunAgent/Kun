import {
  describe,
  expect,
  it
} from 'vitest'
import {
  clawTaskFromTextPayloadSchema,
  scheduleTaskFromTextPayloadSchema,
  settingsPatchSchema
} from './app-ipc-schemas'

describe('app-ipc-schemas settings', () => {
  it('accepts a valid settings patch for kun and write settings', () => {
    const payload = settingsPatchSchema.parse({
      theme: 'dark',
      agents: {
        kun: {
          port: 19000,
          model: 'deepseek-chat',
          approvalReviewer: 'agent',
          modelProfiles: {
            'custom-vision-model': {
              aliases: ['custom-vision'],
              contextWindowTokens: 128000,
              maxOutputTokens: 32000,
              inputModalities: ['text', 'image'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text', 'image_url'],
              serviceTiers: ['priority']
            }
          },
          tokenEconomy: {
            enabled: true,
            compressToolResults: false,
            historyHygiene: {
              maxToolResultTokens: 4000
            }
          },
          toolOutputLimits: {
            maxLines: 30000,
            maxBytes: 1048576
          },
          planExecution: {
            useWorktreeByDefault: false
          },
          subagents: {
            useExistingAgents: false,
            maxParallel: 256,
            maxChildRuns: 25
          }
        }
      },
      write: {
        autoSaveEnabled: false,
        autoSaveDelayMs: 180000,
        inlineCompletion: {
          model: 'deepseek-v4-pro',
          maxTokens: 128
        },
        selectionAssist: {
          infographicPrompt: '手绘风格信息图。',
          quickActions: [
            { id: 'polish', label: '润色一下', prompt: '请润色这段文字。' },
            { id: 'custom-1', label: '', prompt: '' }
          ]
        }
      },
      design: {
        brandColor: '#3b82d8',
        tone: ['专业', '科技感'],
        designSystemPreset: 'shadcn'
      },
      notifications: {
        mainAgentTurnComplete: false,
        subagentTurnComplete: true
      },
      disabledSkillIds: ['test-skill-08']
    })
    expect(payload.agents?.kun?.port).toBe(19000)
    expect(payload.agents?.kun?.approvalReviewer).toBe('agent')
    expect(payload.agents?.kun?.modelProfiles?.['custom-vision-model']?.inputModalities).toEqual(['text', 'image'])
    expect(payload.agents?.kun?.modelProfiles?.['custom-vision-model']?.maxOutputTokens).toBe(32000)
    expect(payload.agents?.kun?.modelProfiles?.['custom-vision-model']?.serviceTiers).toEqual(['priority'])
    expect(payload.agents?.kun?.tokenEconomy?.enabled).toBe(true)
    expect(payload.agents?.kun?.tokenEconomy?.historyHygiene?.maxToolResultTokens).toBe(4000)
    expect(payload.agents?.kun?.toolOutputLimits?.maxLines).toBe(30000)
    expect(payload.agents?.kun?.toolOutputLimits?.maxBytes).toBe(1048576)
    expect(payload.agents?.kun?.planExecution?.useWorktreeByDefault).toBe(false)
    expect(payload.agents?.kun?.subagents).toEqual({
      useExistingAgents: false,
      maxParallel: 256
    })
    expect(payload.write?.autoSaveEnabled).toBe(false)
    expect(payload.write?.autoSaveDelayMs).toBe(180000)
    expect(payload.write?.inlineCompletion?.model).toBe('deepseek-v4-pro')
    expect(payload.write?.selectionAssist?.infographicPrompt).toBe('手绘风格信息图。')
    expect(payload.write?.selectionAssist?.quickActions).toHaveLength(2)
    expect(payload.design?.brandColor).toBe('#3b82d8')
    expect(payload.design?.designSystemPreset).toBe('shadcn')
    expect(payload.notifications).toEqual({
      mainAgentTurnComplete: false,
      subagentTurnComplete: true
    })
    expect(payload.disabledSkillIds).toEqual(['test-skill-08'])
  })

  it('keeps saved Work personas within the runtime turn-persona limit', () => {
    expect(settingsPatchSchema.parse({
      write: { agentPresets: [{ id: 'editor', persona: 'p'.repeat(2_000) }] }
    }).write?.agentPresets?.[0]?.persona).toHaveLength(2_000)
    expect(() => settingsPatchSchema.parse({
      write: { agentPresets: [{ id: 'editor', persona: 'p'.repeat(2_001) }] }
    })).toThrow()
  })

  it('rejects invalid plan execution settings', () => {
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { planExecution: { useWorktreeByDefault: 'yes' } } }
    })).toThrow()
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { planExecution: { unknown: true } } }
    })).toThrow()
  })

  it('rejects low local service ports', () => {
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { port: 9999 } }
    })).toThrow()
    expect(() => settingsPatchSchema.parse({
      claw: { im: { port: 9999 } }
    })).toThrow()
    expect(() => settingsPatchSchema.parse({
      schedule: { internal: { port: 9999 } }
    })).toThrow()
    expect(() => settingsPatchSchema.parse({
      workflow: { webhookPort: 9999 }
    })).toThrow()
  })

  it('rejects unknown approval reviewers', () => {
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { approvalReviewer: 'operator' } }
    })).toThrow()
  })

  it('accepts clearing the provider while keeping the primary model non-empty', () => {
    expect(settingsPatchSchema.parse({
      agents: { kun: { providerId: '' } }
    }).agents?.kun).toEqual({ providerId: '' })
    const emptyModel = settingsPatchSchema.safeParse({
      agents: { kun: { model: '' } }
    })
    expect(emptyModel.success).toBe(false)
    if (!emptyModel.success) {
      expect(emptyModel.error.issues[0]?.path).toEqual(['agents', 'kun', 'model'])
      expect(emptyModel.error.issues[0]?.message).toMatch(/Too small/)
    }
  })

  it('accepts the cursor spotlight preference', () => {
    expect(settingsPatchSchema.parse({ cursorSpotlight: false }).cursorSpotlight).toBe(false)
    expect(settingsPatchSchema.parse({ cursorSpotlightColor: ' #FF8800 ' }).cursorSpotlightColor).toBe('#FF8800')
    expect(() => settingsPatchSchema.parse({ cursorSpotlightColor: 'blue' })).toThrow()
  })

  it('accepts the Linux system title bar preference', () => {
    expect(settingsPatchSchema.parse({
      appBehavior: { useSystemTitleBar: true }
    }).appBehavior).toEqual({ useSystemTitleBar: true })
  })

  it('accepts media generation settings and provider capability patches', () => {
    const payload = settingsPatchSchema.parse({
      provider: {
        providers: [{
          id: 'minimax',
          name: 'MiniMax',
          apiKey: 'sk-media',
          baseUrl: 'https://api.minimaxi.com/anthropic',
          endpointFormat: 'messages',
          useProxy: false,
          models: ['MiniMax-M3'],
          textToSpeech: {
            protocol: 'minimax-t2a',
            baseUrl: 'https://api.minimax.io',
            models: ['speech-2.8-hd']
          },
          music: {
            protocol: 'minimax-music',
            baseUrl: 'https://api.minimax.io',
            models: ['music-2.6']
          },
          video: {
            protocol: 'minimax-video',
            baseUrl: 'https://api.minimax.io',
            models: ['MiniMax-Hailuo-2.3']
          }
        }]
      },
      agents: {
        kun: {
          textToSpeech: {
            enabled: true,
            providerId: 'minimax',
            protocol: 'minimax-t2a',
            model: 'speech-2.8-hd',
            voice: 'male-qn-qingse',
            format: 'mp3',
            timeoutMs: 120000
          },
          musicGeneration: {
            enabled: true,
            providerId: 'minimax',
            protocol: 'minimax-music',
            model: 'music-2.6',
            format: 'mp3',
            timeoutMs: 300000
          },
          videoGeneration: {
            enabled: true,
            providerId: 'minimax',
            protocol: 'minimax-video',
            model: 'MiniMax-Hailuo-2.3',
            defaultDuration: 6,
            defaultResolution: '1080P',
            timeoutMs: 900000,
            pollIntervalMs: 10000
          }
        }
      }
    })

    expect(payload.provider?.providers?.[0]?.textToSpeech?.models).toEqual(['speech-2.8-hd'])
    expect(payload.agents?.kun?.textToSpeech?.enabled).toBe(true)
    expect(payload.agents?.kun?.musicGeneration?.model).toBe('music-2.6')
    expect(payload.agents?.kun?.videoGeneration?.defaultResolution).toBe('1080P')
  })

  it('accepts provider and resolved runtime retry settings', () => {
    const payload = settingsPatchSchema.parse({
      provider: {
        providers: [{
          id: 'deepseek',
          name: 'DeepSeek',
          apiKey: 'sk-test',
          baseUrl: 'https://api.deepseek.com',
          endpointFormat: 'chat_completions',
          useProxy: false,
          retry: {
            maxAttempts: 3,
            initialDelayMs: 3000,
            httpStatusCodes: [429, 503]
          },
          models: ['deepseek-chat'],
          modelProfiles: {}
        }]
      },
      agents: {
        kun: {
          retry: {
            maxAttempts: 3,
            initialDelayMs: 3000,
            httpStatusCodes: [429, 503]
          }
        }
      }
    })

    expect(payload.provider?.providers?.[0]?.retry?.maxAttempts).toBe(3)
    expect(payload.agents?.kun?.retry?.httpStatusCodes).toEqual([429, 503])
  })

  it('accepts service-tier metadata in provider and runtime model profiles', () => {
    const payload = settingsPatchSchema.parse({
      provider: {
        providers: [{
          id: 'codex',
          modelProfiles: {
            'gpt-5.6-sol': {
              serviceTiers: ['priority']
            }
          }
        }]
      },
      agents: {
        kun: {
          modelProfiles: {
            'gpt-5.6-sol': {
              serviceTiers: ['priority']
            }
          }
        }
      }
    })

    expect(
      payload.provider?.providers?.[0]?.modelProfiles?.['gpt-5.6-sol']?.serviceTiers
    ).toEqual(['priority'])
    expect(
      payload.agents?.kun?.modelProfiles?.['gpt-5.6-sol']?.serviceTiers
    ).toEqual(['priority'])
    expect(() => settingsPatchSchema.parse({
      provider: {
        providers: [{
          id: 'codex',
          modelProfiles: {
            'gpt-5.6-sol': {
              serviceTiers: ['express']
            }
          }
        }]
      }
    })).toThrow()
  })

  it('accepts long provider model ids imported from upstream catalogs', () => {
    const longModelId = `openrouter/${'provider-routed-model-id-'.repeat(6)}preview`
    expect(longModelId.length).toBeGreaterThan(128)

    const payload = settingsPatchSchema.parse({
      provider: {
        providers: [{
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          endpointFormat: 'chat_completions',
          useProxy: false,
          models: [longModelId],
          modelProfiles: {
            [longModelId]: {
              aliases: [longModelId],
              contextWindowTokens: 128000
            }
          },
          image: {
            protocol: 'openai-images',
            baseUrl: 'https://openrouter.ai/api/v1',
            models: [longModelId]
          }
        }]
      },
      agents: {
        kun: {
          model: longModelId,
          modelProfiles: {
            [longModelId]: {
              aliases: [longModelId],
              contextWindowTokens: 128000
            }
          },
          imageGeneration: {
            model: longModelId,
            defaultResolution: '2K',
            quality: 'high'
          }
        }
      },
      schedule: {
        model: longModelId
      },
      workflow: {
        model: longModelId
      }
    })

    expect(payload.provider?.providers?.[0]?.models).toEqual([longModelId])
    expect(payload.agents?.kun?.model).toBe(longModelId)
    expect(payload.agents?.kun?.imageGeneration?.defaultResolution).toBe('2K')
    expect(payload.agents?.kun?.imageGeneration?.quality).toBe('high')
    expect(payload.schedule?.model).toBe(longModelId)
    expect(payload.workflow?.model).toBe(longModelId)
    expect(settingsPatchSchema.parse({
      agents: { kun: { imageGeneration: { defaultResolution: '4K' } } }
    }).agents?.kun?.imageGeneration?.defaultResolution).toBe('4K')
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { imageGeneration: { defaultResolution: '8K' } } }
    })).toThrow()
  })

  it('accepts schedule settings patches and task payloads', () => {
    const payload = settingsPatchSchema.parse({
      schedule: {
        enabled: true,
        keepAwake: true,
        defaultWorkspaceRoot: '/tmp/schedule',
        providerId: 'minimax-token-plan',
        model: 'deepseek-v4-flash',
        mode: 'plan',
        promptPrefix: 'Use the project checklist.',
        skills: {
          defaultNames: ['review'],
          extraDirs: ['/tmp/skills']
        },
        internal: {
          port: 19788,
          secret: 'secret'
        },
        tasks: [{
          id: 'task-1',
          title: 'Daily review',
          enabled: true,
          prompt: 'Review the repo',
          workspaceRoot: '/tmp/schedule',
          clawChannelId: 'channel-1',
          providerId: 'minimax-token-plan',
          model: 'auto',
          reasoningEffort: 'high',
          mode: 'agent',
          schedule: {
            kind: 'daily',
            everyMinutes: 60,
            timeOfDay: '09:30',
            atTime: ''
          },
          lastStatus: 'idle'
        }]
      }
    })

    expect(payload.schedule?.internal?.port).toBe(19788)
    expect(payload.schedule?.providerId).toBe('minimax-token-plan')
    expect(payload.schedule?.tasks?.[0]?.schedule?.kind).toBe('daily')
    expect(payload.schedule?.tasks?.[0]?.reasoningEffort).toBe('high')
    expect(payload.schedule?.tasks?.[0]?.clawChannelId).toBe('channel-1')
    expect(payload.schedule?.tasks?.[0]?.providerId).toBe('minimax-token-plan')

    const fromText = scheduleTaskFromTextPayloadSchema.parse({
      text: 'Remind me tomorrow morning to ship the review',
      workspaceRoot: '/tmp/schedule',
      clawChannelId: 'channel-1',
      modelHint: 'deepseek-v4-pro',
      mode: 'agent'
    })

    expect(fromText.workspaceRoot).toBe('/tmp/schedule')
    expect(fromText.clawChannelId).toBe('channel-1')
    expect(fromText.modelHint).toBe('deepseek-v4-pro')
  })

  it('accepts long (>128 char) model ids in claw and schedule fromText modelHint', () => {
    const longModelId = `vendor/${'a'.repeat(249)}`
    expect(longModelId.length).toBe(256)

    const clawParsed = clawTaskFromTextPayloadSchema.parse({
      text: 'Run the long-name model please',
      modelHint: longModelId
    })
    expect(clawParsed.modelHint).toBe(longModelId)

    const scheduleParsed = scheduleTaskFromTextPayloadSchema.parse({
      text: 'Schedule the long-name model please',
      workspaceRoot: '/tmp/schedule',
      modelHint: longModelId
    })
    expect(scheduleParsed.modelHint).toBe(longModelId)
  })

  it('strips legacy settings keys while preserving current skill settings', () => {
    const payload = settingsPatchSchema.parse({
      locale: 'zh',
      disabledSkillIds: ['legacy-skill'],
      reasonix: { model: 'legacy-reasoner' },
      quickChat: { enabled: true },
      provider: {
        providers: [{
          id: 'legacy-vision-provider',
          imageRecognition: { enabled: true }
        }]
      },
      agents: {
        kun: {
          port: 19001,
          imageRecognition: { enabled: true }
        },
        reasonix: {
          model: 'legacy-reasoner'
        },
        quickChat: {
          enabled: true
        }
      }
    })

    expect(payload.locale).toBe('zh')
    expect(payload.provider?.providers?.[0]?.imageRecognition).toEqual({ enabled: true })
    expect(payload.agents?.kun?.port).toBe(19001)
    expect(payload.agents?.kun?.imageRecognition).toEqual({ enabled: true })
    expect(payload.disabledSkillIds).toEqual(['legacy-skill'])
    expect('reasonix' in payload).toBe(false)
    expect('quickChat' in payload).toBe(false)
    expect('reasonix' in (payload.agents ?? {})).toBe(false)
    expect('quickChat' in (payload.agents ?? {})).toBe(false)
  })

  it.each(['en', 'zh', 'ru', 'hi', 'th', 'ja', 'ko'] as const)(
    'accepts the %s application locale in settings patches',
    (locale) => {
      expect(settingsPatchSchema.parse({ locale }).locale).toBe(locale)
    }
  )

  it('rejects unsupported application locales', () => {
    expect(() => settingsPatchSchema.parse({ locale: 'fr' })).toThrow()
  })

  it('accepts persisted claw channel welcome markers in full settings snapshots', () => {
    const payload = settingsPatchSchema.parse({
      claw: {
        channels: [{
          id: 'channel-1',
          provider: 'weixin',
          label: 'weixin agent',
          enabled: true,
          model: 'auto',
          threadId: '',
          workspaceRoot: '',
          agentProfile: {
            name: 'weixin agent',
            description: '',
            identity: '',
            personality: '',
            userContext: '',
            replyRules: ''
          },
          conversations: [],
          welcomeSentAt: '2026-06-10T00:00:00.000Z',
          createdAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '2026-06-10T00:00:00.000Z'
        }]
      }
    })

    expect(payload.claw?.channels?.[0]?.welcomeSentAt).toBe('2026-06-10T00:00:00.000Z')
  })

  it('accepts partial provider profiles in settings patches', () => {
    const payload = settingsPatchSchema.parse({
      provider: {
        apiKey: 'sk-updated',
        providers: [{
          id: 'deepseek',
          apiKey: 'sk-updated',
          endpointFormat: 'responses'
        }]
      }
    })

    expect(payload.provider?.apiKey).toBe('sk-updated')
    expect(payload.provider?.providers?.[0]).toEqual({
      id: 'deepseek',
      apiKey: 'sk-updated',
      endpointFormat: 'responses'
    })
  })

  it('accepts model proxy settings in provider patches', () => {
    const payload = settingsPatchSchema.parse({
      provider: {
        proxy: {
          enabled: true,
          url: 'socks5://127.0.0.1:1080'
        }
      }
    })

    expect(payload.provider?.proxy).toEqual({
      enabled: true,
      url: 'socks5://127.0.0.1:1080'
    })
  })

  it('accepts partial keyboard shortcut binding maps in settings patches', () => {
    const payload = settingsPatchSchema.parse({
      keyboardShortcuts: {
        bindings: {
          settings: ['Ctrl+,']
        }
      }
    })

    expect(payload.keyboardShortcuts?.bindings?.settings).toEqual(['Ctrl+,'])
  })

  it('accepts a configurable stream idle timeout in runtime tuning patches', () => {
    const payload = settingsPatchSchema.parse({
      agents: {
        kun: {
          runtimeTuning: {
            streamIdleTimeoutMs: 300000
          }
        }
      }
    })

    expect(payload.agents?.kun?.runtimeTuning?.streamIdleTimeoutMs).toBe(300000)
  })

  it('accepts a configurable maximum turn duration in runtime tuning patches', () => {
    const payload = settingsPatchSchema.parse({
      agents: {
        kun: {
          runtimeTuning: {
            maxWallTimeMs: 7_200_000
          }
        }
      }
    })

    expect(payload.agents?.kun?.runtimeTuning?.maxWallTimeMs).toBe(7_200_000)
  })

  it('accepts the maximum concurrent turns cap in runtime tuning patches', () => {
    const payload = settingsPatchSchema.parse({
      agents: {
        kun: {
          runtimeTuning: {
            maxConcurrentTurns: 256
          }
        }
      }
    })

    expect(payload.agents?.kun?.runtimeTuning?.maxConcurrentTurns).toBe(256)
  })

  it('accepts the Agent Perspective capture default', () => {
    const payload = settingsPatchSchema.parse({
      agents: {
        kun: {
          llmDebug: {
            defaultThreadCaptureEnabled: true
          }
        }
      }
    })

    expect(payload.agents?.kun?.llmDebug?.defaultThreadCaptureEnabled).toBe(true)
  })

  it('rejects an out-of-range maximum turn duration', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: { kun: { runtimeTuning: { maxWallTimeMs: 86_400_001 } } }
      })
    ).toThrow()
  })

  it('rejects an out-of-range maximum concurrent turns cap', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: { kun: { runtimeTuning: { maxConcurrentTurns: 257 } } }
      })
    ).toThrow()
  })

  it('rejects an out-of-range stream idle timeout', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: { kun: { runtimeTuning: { streamIdleTimeoutMs: -1 } } }
      })
    ).toThrow()
  })

  it('rejects out-of-range tool output limits', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: { kun: { toolOutputLimits: { maxBytes: 128 * 1024 * 1024 } } }
      })
    ).toThrow()
  })

  it('rejects unknown settings patch fields', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: {
          kun: {
            mysteryFlag: true
          }
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('rejects unknown schedule patch fields', () => {
    expect(() =>
      settingsPatchSchema.parse({
        schedule: {
          tasks: [{
            id: 'task-1',
            prompt: 'Run',
            schedule: { kind: 'manual' },
            legacyClawOnlyField: true
          }]
        }
      })
    ).toThrow(/Unrecognized key/)
  })

})
