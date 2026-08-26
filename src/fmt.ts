import { execFile, execFileSync } from 'child_process'
import { isAbsolute, relative, resolve } from 'path'
import { statSync } from 'fs'
import { promisify } from 'util'
import * as core from '@actions/core'

const run = promisify(execFile)

/**
 * Running the format check itself.
 *
 * This is all that is specific to this action; everything else — version
 * selection, downloading, credentials — comes from the shared core.
 */

export interface FormatResult {
  /** Workspace-relative paths that are not in canonical form. */
  unformatted: string[]
  /** Everything the tool printed, including the diff. */
  output: string
}

/** Version a binary reports, or undefined when it cannot be read. */
export function reportedVersion(binary: string): string | undefined {
  try {
    const stdout = execFileSync(binary, ['version', '-json'], { encoding: 'utf8', timeout: 60_000 })
    const parsed = JSON.parse(stdout) as { terraform_version?: string; product?: string }
    return parsed.terraform_version
  } catch {
    return undefined
  }
}

/**
 * Runs a recursive format check and reports which files need reformatting.
 *
 * `fmt -check` prints one offending path per line and exits non-zero; `-diff`
 * also prints the change it would make. Both are captured so the log shows what
 * is wrong rather than only where.
 *
 * The tool is run from the workspace root with a workspace-relative target,
 * because it prints offending paths relative to its working directory. Running
 * it from anywhere else yields paths that resolve nowhere, and since a line that
 * names no existing file is treated as diff text, every unformatted file would
 * be silently discarded and the check would always pass. Workspace-relative
 * paths are also exactly what a `::error file=` annotation needs.
 */
export async function checkFormat(
  binary: string,
  target: string,
  workspaceRoot: string
): Promise<FormatResult> {
  let stdout = ''
  let stderr = ''

  const relativeTarget = relative(workspaceRoot, target) || '.'

  try {
    const completed = await run(
      binary,
      ['fmt', '-check', '-diff', '-recursive', '-no-color', relativeTarget],
      { maxBuffer: 32 * 1024 * 1024, cwd: workspaceRoot }
    )
    stdout = completed.stdout
    stderr = completed.stderr
  } catch (error) {
    // A non-zero exit is the documented signal that files need formatting, so
    // the output still has to be read rather than treated as a failure.
    const failed = error as { stdout?: string; stderr?: string }
    if (failed.stdout === undefined && failed.stderr === undefined) throw error
    stdout = failed.stdout ?? ''
    stderr = failed.stderr ?? ''
  }

  if (stderr.trim()) core.info(stderr.trimEnd())

  // Separate the listed filenames from surrounding diff text by asking the
  // filesystem, which keeps this robust against diff bodies that look like paths.
  const unformatted: string[] = []
  for (const line of stdout.split('\n')) {
    const candidate = line.trim()
    if (!candidate) continue

    const absolute = isAbsolute(candidate) ? candidate : resolve(workspaceRoot, candidate)
    let isFile = false
    try {
      isFile = statSync(absolute).isFile()
    } catch {
      isFile = false
    }
    if (!isFile) continue

    const offset = relative(workspaceRoot, absolute)
    unformatted.push(offset.startsWith('..') ? absolute : offset)
  }

  if (!unformatted.length && stderr.trim() && !stdout.trim()) {
    throw new Error(`fmt failed: ${stderr.trim()}`)
  }

  return { unformatted, output: stdout }
}
