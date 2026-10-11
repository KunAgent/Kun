import { describe, expect, it } from 'vitest'
import { splitPatchByFile } from './patch-split.js'

const header = 'diff --git a/src/a.ts b/src/a.ts\nindex 111..222 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n'

describe('splitPatchByFile', () => {
  it('splits modified files and counts hunks', () => {
    const patch =
      header +
      '@@ -1,2 +1,3 @@\n line\n-removed\n+added\n+added2\n'
    const [file] = splitPatchByFile(patch)
    expect(file.path).toBe('src/a.ts')
    expect(file.status).toBe('modified')
    expect(file.insertions).toBe(2)
    expect(file.deletions).toBe(1)
    expect(file.binary).toBe(false)
    expect(file.patch.startsWith('diff --git')).toBe(true)
  })

  it('marks new files as added', () => {
    const patch =
      'diff --git a/new.ts b/new.ts\nnew file mode 100644\nindex 000..111\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n'
    const [file] = splitPatchByFile(patch)
    expect(file.status).toBe('added')
    expect(file.path).toBe('new.ts')
    expect(file.insertions).toBe(2)
    expect(file.deletions).toBe(0)
  })

  it('marks deleted files and keeps the a-side path', () => {
    const patch =
      'diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\nindex 111..000\n--- a/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n'
    const [file] = splitPatchByFile(patch)
    expect(file.status).toBe('deleted')
    expect(file.path).toBe('gone.ts')
    expect(file.deletions).toBe(2)
    expect(file.insertions).toBe(0)
  })

  it('detects renames with oldPath', () => {
    const patch =
      'diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\nindex 111..222 100644\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-x\n+y\n'
    const [file] = splitPatchByFile(patch)
    expect(file.status).toBe('renamed')
    expect(file.path).toBe('new.ts')
    expect(file.oldPath).toBe('old.ts')
  })

  it('detects binary sections', () => {
    const patch =
      'diff --git a/img.png b/img.png\nindex 111..222 100644\nBinary files a/img.png and b/img.png differ\n'
    const [file] = splitPatchByFile(patch)
    expect(file.binary).toBe(true)
    expect(file.path).toBe('img.png')
  })

  it('counts +/- lines only inside hunks, excluding file headers', () => {
    const patch =
      'diff --git a/f.ts b/f.ts\nindex 1..2 100644\n--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-++ tricky\n+-+ tricky\n'
    const [file] = splitPatchByFile(patch)
    expect(file.insertions).toBe(1)
    expect(file.deletions).toBe(1)
  })

  it('handles quoted paths with spaces', () => {
    const patch =
      'diff --git "a/my file.ts" "b/my file.ts"\nindex 1..2 100644\n--- "a/my file.ts"\n+++ "b/my file.ts"\n@@ -1 +1 @@\n-x\n+y\n'
    const [file] = splitPatchByFile(patch)
    expect(file.path).toBe('my file.ts')
  })

  it('splits multiple sections', () => {
    const patch =
      header + '@@ -1 +1 @@\n-a\n+b\n' +
      'diff --git a/b.ts b/b.ts\nindex 1..2 100644\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1,2 @@\n c\n+d\n'
    const files = splitPatchByFile(patch)
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'b.ts'])
    expect(files[1].insertions).toBe(1)
  })

  it('handles mode-only changes with no hunks', () => {
    const patch =
      'diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n'
    const [file] = splitPatchByFile(patch)
    expect(file.status).toBe('modified')
    expect(file.insertions).toBe(0)
    expect(file.deletions).toBe(0)
  })

  it('returns [] for empty or non-patch input', () => {
    expect(splitPatchByFile('')).toEqual([])
    expect(splitPatchByFile('random text\n')).toEqual([])
  })
})
