import { describe, expect, it } from 'vitest'
import {
  clawImInstallPollPayloadSchema,
  clawTaskFromTextPayloadSchema,
  isSafeOpenExternalUrl,
  runtimeRequestPayloadSchema,
  scheduleTaskFromTextPayloadSchema,
  settingsPatchSchema,
  shellOpenExternalUrlSchema,
  skillGithubImportPayloadSchema,
  skillListPayloadSchema,
  sseStartPayloadSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  writeExportPayloadSchema,
  writeRichClipboardPayloadSchema,
  writeInlineCompletionPayloadSchema
} from './app-ipc-schemas'

describe('app-ipc-schemas', () => {
  it('normalizes runtime request paths', () => {
    const payload = runtimeRequestPayloadSchema.parse({
      path: 'v1/threads?limit=1',
      method: 'GET'
    })

    expect(payload.path).toBe('/v1/threads?limit=1')
  })

  it('accepts the Kun runtime info endpoint', () => {
    const payload = runtimeRequestPayloadSchema.parse({
      path: '/v1/runtime/info',
      method: 'GET'
    })

    expect(payload.path).toBe('/v1/runtime/info')
  })

  it('accepts the Kun runtime tool diagnostics endpoint', () => {
    const payload = runtimeRequestPayloadSchema.parse({
      path: '/v1/runtime/tools',
      method: 'GET'
    })

    expect(payload.path).toBe('/v1/runtime/tools')
  })

  it('accepts the Kun skills endpoint', () => {
    const payload = runtimeRequestPayloadSchema.parse({
      path: '/v1/skills',
      method: 'GET'
    })

    expect(payload.path).toBe('/v1/skills')
  })

  it('accepts Kun attachment and memory endpoints', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/attachments',
      method: 'POST',
      body: '{}'
    }).path).toBe('/v1/attachments')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/attachments/att_1/content?thread_id=thr_1',
      method: 'GET'
    }).path).toBe('/v1/attachments/att_1/content?thread_id=thr_1')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/memory',
      method: 'POST',
      body: '{}'
    }).path).toBe('/v1/memory')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/memory/mem_1',
      method: 'PATCH',
      body: '{}'
    }).path).toBe('/v1/memory/mem_1')
  })

  it('accepts https GitHub skill import URLs and rejects other schemes', () => {
    expect(skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'https://github.com/acme/skills/tree/main/review'
    })).toEqual({
      rootPath: '/tmp/skills',
      url: 'https://github.com/acme/skills/tree/main/review'
    })
    // Scheme-less input is allowed (the importer normalizes it to https).
    expect(skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'github.com/acme/skills'
    }).url).toBe('github.com/acme/skills')
    // Dangerous / non-https explicit schemes are rejected at the boundary.
    expect(() => skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'http://github.com/acme/skills'
    })).toThrow()
    expect(() => skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'file:///etc/passwd'
    })).toThrow()
    expect(() => skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'javascript:alert(1)'
    })).toThrow()
  })

  it('accepts skill list payloads with an optional workspace root', () => {
    expect(skillListPayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace '
    })).toEqual({ workspaceRoot: '/tmp/workspace' })
    expect(skillListPayloadSchema.parse({})).toEqual({})
  })

  it('accepts Kun thread goal endpoints', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/goal',
      method: 'GET'
    }).path).toBe('/v1/threads/thr_1/goal')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/goal',
      method: 'POST',
      body: '{}'
    }).path).toBe('/v1/threads/thr_1/goal')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/goal',
      method: 'DELETE'
    }).path).toBe('/v1/threads/thr_1/goal')
  })

  it('accepts the Kun thread review endpoint', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/review',
      method: 'POST',
      body: '{"target":{"kind":"uncommittedChanges"}}'
    }).path).toBe('/v1/threads/thr_1/review')
  })

  it('accepts the LLM debug rounds endpoint', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/debug/llm-rounds',
      method: 'GET'
    }).path).toBe('/v1/debug/llm-rounds')
  })

  it('rejects runtime request paths outside the modeled Kun API surface', () => {
    expect(() =>
      runtimeRequestPayloadSchema.parse({
        path: '/v1/runtime/secrets',
        method: 'GET'
      })
    ).toThrow(/runtime request path is not allowed/)
  })

  it('rejects runtime request methods that do not match the modeled endpoint', () => {
    expect(() =>
      runtimeRequestPayloadSchema.parse({
        path: '/v1/usage',
        method: 'POST'
      })
    ).toThrow(/runtime request path is not allowed/)
  })

  it('accepts a valid settings patch for kun and write settings', () => {
    const payload = settingsPatchSchema.parse({
      theme: 'dark',
      agents: {
        kun: {
          port: 19000,
          model: 'deepseek-chat',
          modelProfiles: {
            'custom-vision-model': {
              aliases: ['custom-vision'],
              contextWindowTokens: 128000,
              inputModalities: ['text', 'image'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text', 'image_url']
            }
          },
          tokenEconomy: {
            enabled: true,
            compressToolResults: false,
            historyHygiene: {
              maxToolResultTokens: 4000
            }
          }
        }
      },
      write: {
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
      disabledSkillIds: ['test-skill-08']
    })

    expect(payload.agents?.kun?.port).toBe(19000)
    expect(payload.agents?.kun?.modelProfiles?.['custom-vision-model']?.inputModalities).toEqual(['text', 'image'])
    expect(payload.agents?.kun?.tokenEconomy?.enabled).toBe(true)
    expect(payload.agents?.kun?.tokenEconomy?.historyHygiene?.maxToolResultTokens).toBe(4000)
    expect(payload.write?.inlineCompletion?.model).toBe('deepseek-v4-pro')
    expect(payload.write?.selectionAssist?.infographicPrompt).toBe('手绘风格信息图。')
    expect(payload.write?.selectionAssist?.quickActions).toHaveLength(2)
    expect(payload.disabledSkillIds).toEqual(['test-skill-08'])
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

  it('accepts the cursor spotlight preference', () => {
    expect(settingsPatchSchema.parse({ cursorSpotlight: false }).cursorSpotlight).toBe(false)
    expect(settingsPatchSchema.parse({ cursorSpotlightColor: ' #FF8800 ' }).cursorSpotlightColor).toBe('#FF8800')
    expect(() => settingsPatchSchema.parse({ cursorSpotlightColor: 'blue' })).toThrow()
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
            model: longModelId
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
    expect(payload.schedule?.model).toBe(longModelId)
    expect(payload.workflow?.model).toBe(longModelId)
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

  it('rejects an out-of-range stream idle timeout', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: { kun: { runtimeTuning: { streamIdleTimeoutMs: -1 } } }
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

  it('allows only safe external URL protocols', () => {
    expect(isSafeOpenExternalUrl('https://deepseek.com')).toBe(true)
    expect(isSafeOpenExternalUrl('http://127.0.0.1:5173')).toBe(true)
    expect(isSafeOpenExternalUrl('mailto:zhongxingyuemail@gmail.com')).toBe(true)
    expect(isSafeOpenExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeOpenExternalUrl('file:///tmp/test')).toBe(false)
    expect(() => shellOpenExternalUrlSchema.parse('javascript:alert(1)')).toThrow(
      /Only http, https, and mailto URLs are allowed/
    )
  })

  it('rejects invalid SSE payloads', () => {
    expect(() =>
      sseStartPayloadSchema.parse({
        threadId: 'thread-1',
        sinceSeq: -1
      })
    ).toThrow()
  })

  it('accepts long Feishu install device codes', () => {
    const deviceCode = 'x'.repeat(2_048)
    const payload = clawImInstallPollPayloadSchema.parse({
      provider: 'feishu',
      deviceCode
    })

    expect(payload.deviceCode).toBe(deviceCode)
  })

  it('accepts workspace directory payloads without a child path', () => {
    const payload = workspaceDirectoryTargetPayloadSchema.parse({
      workspaceRoot: '/tmp/workspace'
    })

    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.path).toBeUndefined()
  })

  it('accepts workspace directory create payloads', () => {
    const payload = workspaceDirectoryCreatePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: 'notes'
    })

    expect(payload.path).toBe('notes')
  })

  it('accepts workspace rename payloads', () => {
    const payload = workspaceEntryRenamePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: '/tmp/workspace/draft.md',
      newName: 'final.md'
    })

    expect(payload.newName).toBe('final.md')
  })

  it('accepts workspace delete payloads', () => {
    const payload = workspaceEntryDeletePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: '/tmp/workspace/draft.md'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
  })

  it('accepts structured inline completion payloads', () => {
    const payload = writeInlineCompletionPayloadSchema.parse({
      prefix: '## Heading\n\nSome intro',
      suffix: '',
      mode: 'edit',
      workspaceRoot: '/tmp/workspace',
      currentFilePath: '/tmp/workspace/notes.md',
      cursor: {
        line: 3,
        column: 10
      },
      context: {
        language: 'markdown',
        currentLinePrefix: 'Some intro',
        currentLineSuffix: '',
        previousLine: '',
        previousNonEmptyLine: '## Heading',
        nextLine: '',
        indentation: '',
        signals: {
          list: false,
          quote: false,
          heading: false,
          table: false,
          atLineEnd: true,
          endsWithSentencePunctuation: false,
          previousLineEndsWithSentencePunctuation: false,
          prefersNewLineCompletion: false,
          paragraphBreakOpportunity: false
        }
      },
      policy: {
        name: 'precision-inline-v2',
        instruction: 'Return only the inserted text.',
        acceptanceCriteria: ['Keep it short.'],
        rejectionCriteria: ['Do not ramble.']
      },
      preview: {
        local: 'Some intro',
        documentTail: '## Heading Some intro'
      },
      editCandidate: {
        kind: 'paragraph',
        from: 12,
        to: 22,
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 10,
        original: 'Some intro',
        selectedText: 'Some'
      },
      recentEdits: [{
        source: 'user',
        ageMs: 1_200,
        filePath: '/tmp/workspace/notes.md',
        from: 12,
        to: 16,
        deletedText: 'Old',
        insertedText: 'Some',
        beforeContext: '',
        afterContext: ' intro'
      }],
      model: 'deepseek-v4-pro'
    })

    expect(payload.model).toBe('deepseek-v4-pro')
    expect(payload.mode).toBe('edit')
    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.cursor.line).toBe(3)
    expect(payload.editCandidate?.kind).toBe('paragraph')
    expect(payload.recentEdits?.[0].insertedText).toBe('Some')
  })

  it('accepts write export payloads', () => {
    const payload = writeExportPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      format: 'docx',
      content: '# Draft'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
    expect(payload.format).toBe('docx')
    expect(payload.content).toBe('# Draft')
  })

  it('accepts write rich clipboard payloads', () => {
    const payload = writeRichClipboardPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      content: '# Draft'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
    expect(payload.content).toBe('# Draft')
  })
})
