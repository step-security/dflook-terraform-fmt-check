import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { checkFormat } from '../src/fmt.js'

/**
 * A stand-in for the tool binary, so the check can be exercised without
 * downloading Terraform. It reproduces the two behaviours the parser depends on:
 * one offending path per line on stdout, and a non-zero exit.
 */
function fakeTool(dir: string, lines: string[], exitCode: number): string {
  const path = join(dir, 'fake-tool')
  writeFileSync(
    path,
    `#!/bin/bash\n${lines.map((l) => `echo '${l}'`).join('\n')}\nexit ${exitCode}\n`,
    { mode: 0o755 }
  )
  return path
}

function workspace(): { root: string; module: string } {
  const root = mkdtempSync(join(tmpdir(), 'fmt-'))
  const module = join(root, 'infra')
  mkdirSync(module)
  return { root, module }
}

describe('reading the check output', () => {
  it('reports nothing when every file is formatted', async () => {
    const { root, module } = workspace()
    const tool = fakeTool(root, [], 0)

    const result = await checkFormat(tool, module, root)
    expect(result.unformatted).toEqual([])
  })

  it('reports an offending file relative to the workspace', async () => {
    const { root, module } = workspace()
    writeFileSync(join(module, 'main.tf'), 'resource "a" "b" {}\n')
    const tool = fakeTool(root, [join(module, 'main.tf')], 3)

    const result = await checkFormat(tool, module, root)
    expect(result.unformatted).toEqual(['infra/main.tf'])
  })

  /**
   * The real tool prints offending paths relative to its working directory, so
   * they must be resolved against the workspace root. Resolving them against the
   * module instead makes them resolve nowhere, and a line naming no existing
   * file is read as diff text — so the check would silently always pass.
   */
  it('resolves a relative path against the workspace root', async () => {
    const { root, module } = workspace()
    writeFileSync(join(module, 'main.tf'), 'x\n')
    const tool = fakeTool(root, ['infra/main.tf'], 3)

    const result = await checkFormat(tool, module, root)
    expect(result.unformatted).toEqual(['infra/main.tf'])
  })

  /** Paths are only cwd-relative because the tool is run from the root. */
  it('runs the tool from the workspace root with a relative target', async () => {
    const { root, module } = workspace()
    const probe = join(root, 'probe-tool')
    writeFileSync(probe, '#!/bin/bash\necho "cwd=$(pwd)"\necho "target=${@: -1}"\nexit 0\n', {
      mode: 0o755,
    })

    const result = await checkFormat(probe, module, root)
    // realpath, since macOS reports /private/var for /var.
    expect(result.output).toContain(`cwd=${realpathSync(root)}`)
    expect(result.output).toContain('target=infra')
  })

  it('uses . as the target when the module is the workspace root', async () => {
    const { root } = workspace()
    const probe = join(root, 'probe-tool')
    writeFileSync(probe, '#!/bin/bash\necho "target=${@: -1}"\nexit 0\n', { mode: 0o755 })

    const result = await checkFormat(probe, root, root)
    expect(result.output).toContain('target=.')
  })

  /**
   * `-diff` interleaves the patch with the filenames, and a diff line can look
   * like a path. Only lines that name a file that actually exists are counted.
   */
  it('ignores diff lines that resemble paths', async () => {
    const { root, module } = workspace()
    writeFileSync(join(module, 'main.tf'), 'x\n')
    const tool = fakeTool(
      root,
      [join(module, 'main.tf'), '--- old/main.tf', '+++ new/main.tf', '-  x = 1', '+ x = 1'],
      3
    )

    const result = await checkFormat(tool, module, root)
    expect(result.unformatted).toEqual(['infra/main.tf'])
  })

  it('keeps the full output for the log', async () => {
    const { root, module } = workspace()
    writeFileSync(join(module, 'main.tf'), 'x\n')
    const tool = fakeTool(root, [join(module, 'main.tf'), '-  x = 1'], 3)

    const result = await checkFormat(tool, module, root)
    expect(result.output).toContain('-  x = 1')
  })

  it('reports several files', async () => {
    const { root, module } = workspace()
    writeFileSync(join(module, 'a.tf'), 'x\n')
    writeFileSync(join(module, 'b.tf'), 'y\n')
    const tool = fakeTool(root, [join(module, 'a.tf'), join(module, 'b.tf')], 3)

    const result = await checkFormat(tool, module, root)
    expect(result.unformatted.sort()).toEqual(['infra/a.tf', 'infra/b.tf'])
  })

  /** A genuine tool failure has to surface, not be read as "nothing to do". */
  it('fails when the tool errors without listing files', async () => {
    const { root, module } = workspace()
    const path = join(root, 'broken-tool')
    writeFileSync(path, '#!/bin/bash\necho "Error: bad config" >&2\nexit 1\n', { mode: 0o755 })

    await expect(checkFormat(path, module, root)).rejects.toThrow(/fmt failed/)
  })
})
