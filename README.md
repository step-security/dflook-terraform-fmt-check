[![StepSecurity Maintained Action](https://raw.githubusercontent.com/step-security/maintained-actions-assets/main/assets/maintained-action-banner.png)](https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions)

# terraform-fmt-check

Fails the job when any Terraform file in your repository is not in canonical format, and annotates each offending file on the pull request diff.

> This is a secure drop-in replacement for [dflook/terraform-fmt-check](https://github.com/dflook/terraform-fmt-check). Learn more at [docs.stepsecurity.io](https://docs.stepsecurity.io/github-actions/actions/stepsecurity-maintained-actions).

## What it does

Runs `terraform fmt -check -recursive` over a directory. Nothing is modified — the check reports, it never rewrites your files.

Two things make the result usable in review:

- **Each unformatted file gets a GitHub annotation**, so the problem appears against the file in the pull request rather than buried in the job log.
- **The diff is printed**, so you can see the change Terraform would make without running it locally first.

No credentials are needed and no backend is contacted, which makes this safe to run on pull requests from forks.

## Usage

```yaml
name: Check Terraform formatting

on: [pull_request]

jobs:
  fmt-check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7

      - name: Check formatting
        uses: step-security/dflook-terraform-fmt-check@v3
        with:
          path: infrastructure
```

## Inputs

| Name | Required | Description |
| --- | --- | --- |
| `path` | no | Directory to check, searched recursively. Defaults to the workspace root. |
| `workspace` | no | Accepted for compatibility with the wider Terraform action suite; unused here. |
| `backend_config` | no | Accepted for compatibility; unused here. |
| `backend_config_file` | no | Accepted for compatibility; unused here. |

The three compatibility inputs exist because the sibling Terraform actions use them to reach a remote backend when working out which Terraform version to run. Formatting only reads files from disk, so they have no effect — see [Terraform version](#terraform-version) for what does.

## Outputs

| Name | Description |
| --- | --- |
| `failure_reason` | `check-failed` when the job failed because files need reformatting. Unset for any other failure. |
| `failure-reason` | The hyphenated spelling, carrying the same value. |

Both names are published so either can be referenced. Because the output is only set for a formatting failure, it distinguishes "files need reformatting" from "the action itself broke":

```yaml
      - name: Check formatting
        id: fmt
        uses: step-security/dflook-terraform-fmt-check@v3

      - name: Explain how to fix it
        if: failure() && steps.fmt.outputs.failure-reason == 'check-failed'
        run: echo "Run 'terraform fmt -recursive' and commit the result."
```

## Terraform version

The action works out which version to run from your configuration, checking these in order and using the first that applies:

1. a `required_version` constraint in the Terraform configuration
2. a `.tfswitchrc` file
3. an `.opentofu-version` file
4. a `.terraform-version` file
5. a `terraform` entry in `.tool-versions` (asdf), searching upwards to the workspace root
6. the `TERRAFORM_VERSION` environment variable
7. the version recorded in local state, when the state has been written to
8. otherwise, the latest release

The configuration wins over the environment deliberately: `required_version` describes what the code needs, so a workflow-wide `TERRAFORM_VERSION` default does not silently override a module that pins something narrower. Every step logs which version it picked and why.

Most of these accept a constraint rather than an exact version — `~> 1.5` resolves to the newest matching release. A pre-release is only ever selected when named exactly, so `~> 1.6` will not give you `1.6.0-alpha1`.

```yaml
      - name: Check formatting
        uses: step-security/dflook-terraform-fmt-check@v3
        env:
          TERRAFORM_VERSION: 1.9.8
```

Set `OPENTOFU_VERSION` (or `OPENTOFU: true`) to use OpenTofu instead. When OpenTofu is selected, Terraform versions below `1.6.0` are excluded, since that is where the projects diverge.

Whenever a version is downloaded, the archive is compared against the published `SHA256SUMS` **before it is extracted** — an archive that fails is never unpacked or executed. Both files are fetched over HTTPS from the release host, so this confirms the download arrived intact and matches the release requested. Downloads go into the runner tool cache, so a repeated version costs no network at all.

## Fixing what it reports

The check never edits your files. To fix the reported files locally:

```bash
terraform fmt -recursive
```

## Development

Version resolution, downloading and verification are shared with the sibling
Terraform actions through
[`dflook-terraform-actions-core`](https://github.com/step-security/dflook-terraform-actions-core),
included here as a submodule at `vendor/core`. Only the format check itself lives
in this repository. The submodule is bundled into `dist/` at build time, so
consumers of the action never need to fetch it.

```bash
git clone --recurse-submodules https://github.com/step-security/dflook-terraform-fmt-check.git
npm ci
npm test
npm run build   # regenerates dist/, which is committed
```

An existing clone needs `git submodule update --init` once; without it the build
cannot resolve `@core`.
