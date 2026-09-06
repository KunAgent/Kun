import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

type ReleaseVersionResult = {
  version: string
  tag: string
  releaseName: string
  previousTag: string
  existingTag: boolean
}

type ReleaseVersionModule = {
  computeCandidateVersion(packageVersion: string): ReleaseVersionResult
  computeReleaseVersion(input: {
    allTags?: string[]
    headTags?: string[]
    packageVersion: string
  }): ReleaseVersionResult
  newestSemverTag(tags: string[]): { tag: string; version: string } | null
}

const releaseVersion = require('../../scripts/compute-ci-release-version.cjs') as ReleaseVersionModule

describe('CI release version computation', () => {
  it('builds an unpublished candidate at the package version without advancing or reusing a tag', () => {
    expect(releaseVersion.computeCandidateVersion('0.3.8')).toEqual({ version: '0.3.8', tag: 'v0.3.8',
      releaseName: 'Kun 0.3.8', previousTag: '', existingTag: false })
    expect(() => releaseVersion.computeCandidateVersion('invalid')).toThrow()
  })
  it('bumps package.json patch version when no release tags exist', () => {
    expect(
      releaseVersion.computeReleaseVersion({
        allTags: [],
        headTags: [],
        packageVersion: '0.1.0'
      })
    ).toEqual({
      version: '0.1.1',
      tag: 'v0.1.1',
      releaseName: 'Kun 0.1.1',
      previousTag: '',
      existingTag: false
    })
  })

  it('ignores legacy four-part tags and bumps the newest three-part tag', () => {
    expect(
      releaseVersion.computeReleaseVersion({
        allTags: ['v0.1.16', 'v0.2.3', 'v0.2.4.1', 'v0.2.4'],
        headTags: [],
        packageVersion: '0.1.0'
      })
    ).toMatchObject({
      version: '0.2.5',
      tag: 'v0.2.5',
      previousTag: 'v0.2.4',
      existingTag: false
    })
  })

  it('reuses a semver tag that already points at HEAD for reruns', () => {
    expect(
      releaseVersion.computeReleaseVersion({
        allTags: ['v0.2.3', 'v0.2.4', 'v0.2.5'],
        headTags: ['v0.2.5'],
        packageVersion: '0.1.0'
      })
    ).toMatchObject({
      version: '0.2.5',
      tag: 'v0.2.5',
      previousTag: 'v0.2.4',
      existingTag: true
    })
  })

  it('uses the highest semver tag when multiple tags point at HEAD', () => {
    expect(
      releaseVersion.computeReleaseVersion({
        allTags: ['v0.2.4', 'v0.2.5', 'v0.2.6'],
        headTags: ['v0.2.5', 'v0.2.6'],
        packageVersion: '0.1.0'
      })
    ).toMatchObject({
      version: '0.2.6',
      tag: 'v0.2.6',
      previousTag: 'v0.2.5',
      existingTag: true
    })
  })

  it('uses a package.json version newer than the latest tag as an explicit bump', () => {
    expect(
      releaseVersion.computeReleaseVersion({
        allTags: ['v0.2.36', 'v0.2.37'],
        headTags: [],
        packageVersion: '0.3.0'
      })
    ).toMatchObject({
      version: '0.3.0',
      tag: 'v0.3.0',
      previousTag: 'v0.2.37',
      existingTag: false
    })
  })

  it('still bumps the patch when package.json is not newer than the latest tag', () => {
    expect(
      releaseVersion.computeReleaseVersion({
        allTags: ['v0.2.37'],
        headTags: [],
        packageVersion: '0.2.37'
      })
    ).toMatchObject({
      version: '0.2.38',
      tag: 'v0.2.38',
      previousTag: 'v0.2.37',
      existingTag: false
    })
  })

  it('returns null when there are no valid semver tags', () => {
    expect(releaseVersion.newestSemverTag(['v0.2.4.1', 'not-a-tag'])).toBeNull()
  })
})
