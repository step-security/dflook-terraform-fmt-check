import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { InputError, loadInputs } from '../src/inputs.js'

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'fmt-check-ws-'))
  process.env.GITHUB_WORKSPACE = workspace
  delete process.env.INPUT_PATH
})

afterEach(() => {
  delete process.env.GITHUB_WORKSPACE
  delete process.env.INPUT_PATH
})

describe('resolving path', () => {
  it('defaults to the workspace root', () => {
    expect(loadInputs().path).toBe(workspace)
  })

  it('resolves a subdirectory', () => {
    mkdirSync(join(workspace, 'infra'))
    process.env.INPUT_PATH = 'infra'
    expect(loadInputs().path).toBe(join(workspace, 'infra'))
  })

  it('accepts a ./ prefix', () => {
    mkdirSync(join(workspace, 'infra'))
    process.env.INPUT_PATH = './infra'
    expect(loadInputs().path).toBe(join(workspace, 'infra'))
  })

  it('treats a blank value as the workspace root', () => {
    process.env.INPUT_PATH = '   '
    expect(loadInputs().path).toBe(workspace)
  })
})

/**
 * path arrives from workflow input, so it must not be able to reach outside the
 * checkout even though the caller is usually trusted.
 */
describe('confining path to the workspace', () => {
  it.each([
    ['a parent traversal', '../elsewhere'],
    ['a nested traversal', 'infra/../../elsewhere'],
    ['an absolute path', '/etc'],
  ])('rejects %s', (_label, value) => {
    process.env.INPUT_PATH = value
    expect(() => loadInputs()).toThrow(InputError)
    expect(() => loadInputs()).toThrow(/stay inside the workspace/)
  })
})

describe('validating the target', () => {
  it('rejects a path that does not exist', () => {
    process.env.INPUT_PATH = 'absent'
    expect(() => loadInputs()).toThrow(/does not exist/)
  })

  it('rejects a file', () => {
    writeFileSync(join(workspace, 'main.tf'), '')
    process.env.INPUT_PATH = 'main.tf'
    expect(() => loadInputs()).toThrow(/is not a directory/)
  })
})
