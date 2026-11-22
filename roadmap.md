# APK publishing

- [x] Replace Actions artifact and external-host delivery with verified GitHub Release assets in the existing Android workflows.
- [x] Test publication, failure handling, and direct APK URLs without rebuilding the app (22 publishing/workflow tests and 6 existing app regression tests pass).
- [ ] Verify a newly built APK using the changed publisher: blocked by the latest GitHub job having no assigned Blacksmith runner; current workflows remain manual because Codemagic is the existing automatic builder, whose external GITHUB_RELEASE_TOKEN configuration cannot be verified here. Existing APK #219 is confirmed uploaded in GitHub Releases, not a new build.