import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateRenderPlan, type FfmpegRenderStep, type RenderKind } from '../src/engine/index.js'
import { makeItem, makeProject } from './fixtures.js'

const ffmpeg = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'
const encoderProbe = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], {
  encoding: 'utf8',
  timeout: 10_000
})
const canRenderH264 = encoderProbe.status === 0 &&
  `${encoderProbe.stdout}${encoderProbe.stderr}`.includes('libx264')
const ffmpegIt = canRenderH264 ? it : it.skip
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('render plans against the installed FFmpeg', () => {
  ffmpegIt('technically validates aligned proof, preview, and H.264 outputs without claiming visual review', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kun-video-render-plan-'))
    temporaryDirectories.push(directory)
    const source = join(directory, 'source.mp4')
    runFfmpeg([
      '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=1.000000',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.000000',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source
    ])

    const transformedProject = makeProject()
    transformedProject.captions = []
    transformedProject.canvas = {
      ...transformedProject.canvas,
      width: 640,
      height: 360,
      fit: 'crop'
    }
    transformedProject.items = [{
      ...transformedProject.items[0]!,
      durationFrames: 30,
      sourceEndUs: 1_000_000,
      transform: {
        ...transformedProject.items[0]!.transform,
        scaleX: 0.5,
        scaleY: 0.5
      }
    }]
    const proofPlan = renderPlan(transformedProject, 'proof-frame', 15)
    const proof = proofPlan.steps[0] as FfmpegRenderStep
    const proofGraph = proof.args[proof.args.indexOf('-filter_complex') + 1]!
    expect(proofGraph).toContain(':d=0.533333[base]')
    const proofOutput = join(directory, 'proof.png')
    runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', ...materialize(
      proof,
      source,
      proofOutput
    )])
    expect(statSync(proofOutput).size).toBeGreaterThan(0)

    const previewPlan = renderPlan(transformedProject, 'preview')
    const finalPlan = renderPlan(transformedProject, 'h264-mp4')
    expect(previewPlan.renderIrDigest).toBe(finalPlan.renderIrDigest)
    expect(previewPlan.backendCapabilitiesDigest).toBe(finalPlan.backendCapabilitiesDigest)
    expect(previewPlan.renderIr).toEqual(finalPlan.renderIr)
    expect(proofPlan.renderIr.layers[0]!.visual).toEqual(previewPlan.renderIr.layers[0]!.visual)
    expect([proofPlan, previewPlan, finalPlan].map(({ verification }) => verification)).toEqual([
      { technicalValidation: 'pending', visualInspection: 'not-performed' },
      { technicalValidation: 'pending', visualInspection: 'not-performed' },
      { technicalValidation: 'pending', visualInspection: 'not-performed' }
    ])
    const transformed = previewPlan.steps[0] as FfmpegRenderStep
    const transformedGraph = transformed.args[transformed.args.indexOf('-filter_complex') + 1]!
    expect(transformedGraph).toContain(':d=1.000000[base]')
    const transformedOutput = join(directory, 'transformed.mp4')
    runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', ...materialize(
      transformed,
      source,
      transformedOutput
    )])
    expect(statSync(transformedOutput).size).toBeGreaterThan(0)
    expect(probeDurationSeconds(transformedOutput)).toBeGreaterThan(0.8)

    const finalOutput = join(directory, 'transformed-final.mp4')
    runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', ...materialize(
      finalPlan.steps[0] as FfmpegRenderStep,
      source,
      finalOutput
    )])
    expect(statSync(finalOutput).size).toBeGreaterThan(0)
    expect(probeDurationSeconds(finalOutput)).toBeGreaterThan(0.8)

    const cutsProject = makeProject()
    cutsProject.captions = []
    cutsProject.canvas = { ...cutsProject.canvas, width: 640, height: 360 }
    cutsProject.items = Array.from({ length: 30 }, (_unused, index) => ({
      ...makeItem(`clip-${index}`, index * 3, 0, 100_000),
      durationFrames: 3
    }))
    const cuts = ffmpegStep(cutsProject, 'h264-mp4')
    const cutsGraph = cuts.args[cuts.args.indexOf('-filter_complex') + 1]!
    expect(cutsGraph).toContain('concat=n=30:v=1:a=1[vout][aout]')
    expect(cutsGraph.length).toBeLessThanOrEqual(8_000)
    const cutsOutput = join(directory, 'thirty-cuts.mp4')
    runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', ...materialize(
      cuts,
      source,
      cutsOutput
    )], 120_000)
    expect(statSync(cutsOutput).size).toBeGreaterThan(0)
    expect(probeDurationSeconds(cutsOutput)).toBeGreaterThan(2.5)

    runFfmpeg([
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-i', proofOutput, '-f', 'null', '-'
    ])
    runFfmpeg([
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-i', transformedOutput, '-f', 'null', '-'
    ])
    runFfmpeg([
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-i', finalOutput, '-f', 'null', '-'
    ])
    runFfmpeg([
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-i', cutsOutput, '-f', 'null', '-'
    ])
  }, 150_000)
})

function ffmpegStep(
  project: ReturnType<typeof makeProject>,
  kind: 'proof-frame' | 'preview' | 'h264-mp4',
  proofFrame?: number
): FfmpegRenderStep {
  return renderPlan(project, kind, proofFrame).steps[0] as FfmpegRenderStep
}

function renderPlan(
  project: ReturnType<typeof makeProject>,
  kind: Extract<RenderKind, 'proof-frame' | 'preview' | 'h264-mp4'>,
  proofFrame?: number
): ReturnType<typeof generateRenderPlan> {
  return generateRenderPlan(project, {
    kind,
    expectedRevision: project.currentRevision,
    outputHandleId: 'render-output',
    ...(proofFrame === undefined ? {} : { proofFrame })
  })
}

function materialize(step: FfmpegRenderStep, source: string, output: string): string[] {
  const args = step.args.map((argument) => argument
    .replace(/\{\{input:[^}]+\}\}/gu, source)
    .replace(/\{\{output:[^}]+\}\}/gu, output))
  if (args.some((argument) => argument.includes('{{'))) {
    throw new Error('The test did not resolve every FFmpeg placeholder')
  }
  return args
}

function runFfmpeg(args: string[], timeout = 60_000): void {
  const result = spawnSync(ffmpeg, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 10 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(
      `FFmpeg failed (status=${String(result.status)}, signal=${String(result.signal)}):\n` +
      `${result.stderr || result.stdout}`
    )
  }
}

function probeDurationSeconds(file: string): number {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', file], {
    encoding: 'utf8',
    timeout: 10_000
  })
  const match = /Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/u.exec(result.stderr)
  if (!match) throw new Error(`FFmpeg did not report a duration for ${file}:\n${result.stderr}`)
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}
