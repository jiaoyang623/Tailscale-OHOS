# Contributing to MeshArc

Documentation, translations, device testing and code contributions are welcome.

## Report a problem

Search [existing issues](https://github.com/flypigJ/Tailscale-OHOS/issues) first, then include:

- App version and installation source.
- Device model and HarmonyOS version.
- Steps to reproduce, expected behavior and actual result.
- Whether exit nodes, subnet routes or another VPN are involved.
- Redacted diagnostics or screenshots when useful.

Remove authentication URLs, keys, tokens, personal account details, device identifiers, tailnet addresses, file paths and signing information before posting diagnostics publicly.

## Propose a change

1. For larger changes, open an issue describing the use case first.
2. Keep each pull request focused; preserve existing protocols, persisted formats and user data.
3. Keep project documentation in English. For app UI changes, maintain both English and Chinese resources.
4. Describe the behavior change and validation; say explicitly when device testing was not performed.

For setup and device checks, see the [Windows development guide](docs/development.md) or [macOS build guide](docs/build-macos.md).

## Ways to help

- Improve onboarding, installation notes and troubleshooting.
- Refine the app's English and Chinese copy.
- Report real-device behavior across phones, tablets and 2in1 devices.
- Reproduce and narrow down network-transition, transfer or layout issues.

Run `scripts/run-checks.sh` before submitting: it runs the unit and integration tests and the
oracle checks. If you change behaviour, update the criteria that describe it — see the
[design records and criteria](docs/development.md#design-records-criteria-and-review-the-a01-chain)
section of the development guide. A criterion whose anchor names a test that does not exist
fails the gate.

If you changed a design document or a criterion, also run `scripts/a01-review-pages.sh`. It runs
the gate first and then rebuilds the four review pages, because a page generated without a green
run on that baseline would claim a result nobody observed. Any reviewer conclusion on an item
you touched goes stale until it is re-signed — that is the mechanism working, not a bug.

Check your diff before submitting. Exclude unrelated changes, generated build output, dependency directories and signing credentials. Application releases follow the versioning, changelog and signing process in the development guide.

## License

MeshArc uses the [BSD 3-Clause License](LICENSE). Preserve existing copyright notices and third-party license terms when contributing.
