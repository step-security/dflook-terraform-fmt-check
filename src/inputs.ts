import { existsSync, statSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'

export class InputError extends Error {}

export interface Inputs {
  /** Directory whose Terraform files are checked. */
  path: string
  /** Workspace root that `path` was resolved against. */
  workspaceRoot: string
}

function read(name: string, fallback = ''): string {
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? fallback).trim()
}

/**
 * Builds the input set, resolving `path` against the runner workspace.
 *
 * `workspace`, `backend_config` and `backend_config_file` are part of this
 * action's published interface, but they exist to describe how to reach a remote
 * backend when discovering a Terraform version. Formatting only ever reads files
 * from disk, so those inputs are accepted and ignored rather than removed — that
 * keeps the interface intact for anyone migrating across.
 */
export function loadInputs(): Inputs {
  const workspaceRoot = resolve(process.env.GITHUB_WORKSPACE || process.cwd())
  const requested = read('path', '.') || '.'
  const target = resolve(workspaceRoot, requested)

  // The path comes from workflow input and has no business pointing outside the
  // checkout, so confine it rather than trusting the caller.
  const offset = relative(workspaceRoot, target)
  if (offset.startsWith('..') || isAbsolute(offset)) {
    throw new InputError(
      `path must stay inside the workspace, but '${requested}' resolves outside it`
    )
  }

  if (!existsSync(target)) {
    throw new InputError(`path '${requested}' does not exist`)
  }
  if (!statSync(target).isDirectory()) {
    throw new InputError(`path '${requested}' is not a directory`)
  }

  return { path: target, workspaceRoot }
}
