# Validation record

Date: 2026-11-08. Initial local host: Apple Silicon, macOS 26.6.2. The original local checks did not use Windows or GitHub Actions. The subsequent GitHub-hosted Windows/macOS results are recorded in the publication follow-up below.

## Source selection

Only the Desktop working copy existed at the start. Sixty original files, including Git metadata and bundled assets, were copied out of the cloud-synchronized Desktop and SHA-256 compared before editing. The original source was preserved. Development continued in the non-cloud Developer directory. No existing commits or remote repository were configured.

## Checks performed

- `npm ci` completed in the new directory; the Swift input bridge compiled locally.
- Eleven Node tests passed: six animation cases, two character-store cases, two language/catalog and migration cases, and one Windows packaging configuration case.
- Electron integration tests passed on Electron 45.2.3, including the second-process restart phase. These exercise four PNG imports, later blink addition, five-PNG imports, 2×2 sheets, Purple Cat pixel stability, blink interruption, transparent/opaque touch hit testing, bounce completion, free movement, position persistence, language switching, draft-name retention, translated native menus, and English layout at 980×740 and 780×600.
- `npm audit` reported zero vulnerabilities after updating Electron and resolving the build-tool minimatch dependency. This is the registry audit result at the time of this run, not a guarantee against all vulnerabilities.
- A clean arm64 DMG and ZIP were built from the new working directory. The ZIP was extracted into a separate, ignored smoke-test directory.
- The package verifier compared every `src/` file in `app.asar` with the final working sources. It also checked both language catalogs, Purple Cat's five PNGs, PNG/ICNS logo assets, and the native Mac input bridge.
- `codesign --verify --deep --strict` passed for the built app and the independently extracted ZIP app. The app has a complete local ad hoc resource seal. It is not Developer ID signed or notarized. This does not establish Gatekeeper acceptance on another Mac.
- The extracted ZIP app was opened through native desktop controls. Its URL pointed into the extracted `app.asar`, rather than the development tree or older Desktop package.
- Turkish and English were checked in that actual package. The app was quit from its translated native menu and reopened; English remained selected. User character names remained unchanged.
- Four actual PNG files were chosen through the native file picker in the packaged app. Progress advanced through 1/4, 2/4, 3/4 and 4/4; saving remained disabled until the fourth image. That manual draft was canceled without adding disposable characters to the user's library. Save/restart/source-deletion behavior is covered separately by automated tests.
- The supplied Purple Cat and supplied logo were visually inspected in the extracted package. Purple Cat was selected for the final open application.
- Discord was put into native fullscreen without sending a message. The user confirmed that the character was visible above it. The first confirmation concerned the existing package. After granting permission to the exact extracted copy, the user separately confirmed native fullscreen visibility for the final rebuilt package as well.

## Distinguish simulation from physical acceptance

The integration suite uses DOM events, renderer test hooks, direct animation calls, explicit drag coordinates and synthetic touch queries. The click-through assertion checks the configured state, not delivery to another application. It does not impersonate a physical keyboard or prove that a game accepts global hooks.

The first attempt to observe actual global input from the new development path reported no Input Monitoring permission and was not counted as a pass. The user subsequently granted Input Monitoring to the exact extracted ZIP application. An older copy from Applications was found running and was closed; after the extracted copy started, its permission notice disappeared. No OS permission was enabled by the agent.

A subsequent 30-second observation of the exact packaged native bridge reported `P:1` and received 15 anonymous keyboard strike events and 10 mouse strike events. This was observation of real OS events, not calls into the animation controller; it did not record letters or reconstruct typed text. The observer was a separate bridge process, so its event counts alone are not proof of the overlay's full behavior.

A blank local TextEdit document was opened from `/private/tmp/masaustu-karakter-input-test.txt`. An attempted automated typing sequence was interrupted when window focus changed and was not counted as a completed automated acceptance test.

The user then explicitly confirmed the following on the **final extracted ZIP copy**:

- Holding W for two seconds produces a single strike.
- Pressing A while W is held produces a new strike.
- Rapid typing stops without an animation backlog.
- Keyboard plus left/right mouse input shows both hands.
- Clicking through the character reaches the underlying application.
- Normal click-through returns after moving the character.
- The character remains visible above native fullscreen Discord.

These visual/physical results are user acceptance evidence, separate from the automated tests and the independent bridge observation. The rebuilt application was left open with the user's latest size, position and language preferences preserved.

## Remaining platform/distribution checks

- Complete physical Windows x64 acceptance: typing, mouse, direct dragging, game/fullscreen behavior and both installer/portable launch paths. CI build, native hook registration and unpacked packaged-app startup have since passed, as recorded below.
- For public/commercial Mac distribution, configure Developer ID signing and notarization and test an Internet-downloaded copy on another Mac. Current local ad hoc signature verification does not establish Gatekeeper acceptance on another machine.

## 0.1.1 direct dragging follow-up

- Added visible-pixel direct dragging without opening the controls or entering move mode. A six-point movement threshold keeps ordinary clicks from moving the character; release saves the position. Transparent pixels do not start a drag. Normal click-through remains enabled, so an underlying application may also receive the drag gesture.
- The first packaged attempt failed the user's physical drag test while Input Monitoring permission was absent. This was not counted as a pass. The Mac bridge was then updated to use public mouse-button state polling when its mouse event tap is unavailable or keyboard monitoring permission is absent.
- Thirteen Node tests passed, including direct-drag threshold, alpha-hit rejection, delayed-response handling and the separate left-button bridge protocol. Electron integration tests passed, including renderer alpha-hit confirmation, movement with move mode disabled, click-through configuration and position persistence after restart. These are simulated controller/renderer tests, not physical OS input tests.
- The corrected 0.1.1 packaged app was reopened. The user explicitly confirmed that holding and dragging the desktop cat now moves it without using the Move character button. This is physical user acceptance of direct dragging on this Mac, separate from the automated tests.
- The package verifier passed against the final app. Windows direct dragging was implemented in the native mouse-hook protocol but has not been run on Windows. Earlier 0.1.0 keyboard/fullscreen acceptance above does not establish a fresh physical keyboard/fullscreen pass for 0.1.1.

## Outstanding limitations from code review

- The Mac Caps Lock handler emits a strike when enabling Caps Lock, not when disabling it.
- A bridge process failure is not automatically recovered; the existing permission UI is not a complete bridge-health indicator.
- Storage-level PNG validation checks the header/dimensions rather than fully decoding the file. The normal upload UI decodes the image and catches invalid-file errors before saving.
- Some games, secure input fields and protected desktops may prevent capture; exclusive fullscreen behavior on Windows has not been tested.

## Distribution and repository status

The Windows build script, resource-copy settings and runtime path agree on `input-bridge-win-x64.exe`. The setup/portable name collision was fixed. CI now builds and verifies on each platform and uploads artifacts only; no release publication action is configured. A configuration review is not a Windows runtime test.

Generated packages, dependencies, native binaries, screenshots generated under test-output directories, local characters/settings, logs, environment files and signing secrets are ignored. Documentation screenshots contain only bundled art and synthetic test characters. No personal character art was added to the source tree. At the end of the original 0.1.0 preparation, no push, GitHub Release publication, remote URL, or open-source license had been added. The subsequent license choice is recorded below.

## 0.1.2 Dosty branding and public-source preparation

- The owner requested the name Dosty and explicitly selected GPL-3.0. The project now declares GPL-3.0-only, includes the unmodified GNU GPL v3 text downloaded from GNU, and retains Electron/Chromium notices in packages. No remote repository, commit, push or public release was created. A separate source-only ZIP was prepared using Git's non-ignored file list; it excludes generated packages, dependencies, private character libraries and settings.
- English and Turkish READMEs introduce Dosty, link to each other and to updated Dosty screenshots, and explain installing release assets versus downloading source code. The owner's complete English/Turkish character prompts are included as copyable Markdown files linked from the READMEs.
- Branding was updated in the UI, native menus, package name, application bundle name, verifier and build workflow. The internal application ID remains unchanged. Existing user libraries are reused in place; fresh installations use Dosty's application-data directory. The actual installed app displayed the existing character names, selected language, size and position.
- Fourteen Node tests passed. Electron integration checks passed, including the Dosty window title, both languages, layout and restart persistence. README/prompt local links resolved. Full `npm audit` reported zero vulnerabilities at this run.
- Fresh Dosty 0.1.2 arm64 ZIP/DMG packages were built. The source/license/artwork/native-bridge verifier and strict deep signature verification passed for the build, the separately extracted ZIP and `/Applications/Dosty.app`. The installed and built app.asar SHA-256 hashes matched.
- While preparing this version, the user reported that keyboard input did not animate. The still-running 0.1.1 app displayed a missing Input Monitoring notice; its earlier direct-mouse-drag acceptance was not a keyboard acceptance test. The old app was closed. The fixed-location Dosty copy also reported no keyboard permission, despite an enabled settings entry. A read-only check of macOS TCC logs showed a saved code-signature requirement mismatch against the older build, explaining the enabled switch with denied access. The user removed the stale entry and personally approved the exact `/Applications/Dosty.app` version 0.1.2 in the file picker. The permission notice disappeared, and the actual packaged UI showed a Keyboard pose. The user then explicitly confirmed that the desktop character reacts while typing in a blank local TextEdit document. This is fresh user acceptance of background keyboard input for 0.1.2; the detailed hold/chord/fullscreen cases remain the earlier version's acceptance evidence.
- Turkish and English were also switched through the installed 0.1.2 app's actual language selector, including translated native menu labels. The user's English preference was restored. The installed app was left open with permission working.
- Every friend's Mac must grant its own Input Monitoring permission; GitHub does not transfer permissions. The package remains locally ad hoc signed, not notarized. Download/Gatekeeper behavior on a second Mac and Windows execution remain unverified.

## GitHub publication and Windows CI follow-up

- After the owner explicitly requested upload and build startup, the public repository was created at https://github.com/saido-11/Dosty and the sources were pushed. Commits use the account's GitHub noreply address. Ignored packages, dependencies and user data were excluded.
- The first Windows run passed all 14 unit tests and the integration assertions, but failed deleting a profile that was still open in the first Electron process. A Node driver now runs the two Electron phases sequentially, with the first process fully exited before reopening the profile. This also removes shared-profile cache locking; both phases and cleanup passed on Windows afterward.
- A subsequent Windows package check exposed platform-native ASAR separators. The verifier now normalizes listed paths and passes native normalized paths back to ASAR extraction; the file-presence and byte-for-byte source comparisons were retained.
- [Run 42505987951](https://github.com/saido-11/Dosty/actions/runs/42505987951), source commit `ac73a254de00fb180433b696f0dc44269bff12d2`, passed both macOS and Windows jobs. Both ran 14 unit tests, Electron integration/restart tests, native compilation, packaging and package verification. Outputs include arm64 Mac ZIP/DMG and x64 Windows setup/portable EXEs.
- The Windows startup smoke test ran the exact packaged bridge and received `P:1` after both native hook registrations succeeded. It then launched packaged `Dosty.exe` with isolated temporary settings and confirmed that the app spawned the bundled bridge from `resources/bin/input-bridge-win-x64.exe`, kept that child process alive and wrote initial settings. Test processes and their isolated data were cleaned up.
- This is execution on a GitHub-hosted Windows runner, not physical input acceptance. No real user typing/clicking/dragging, game or fullscreen Windows pass is claimed. The EXE installer and portable launchers still need user acceptance on an ordinary Windows desktop; the startup smoke uses `win-unpacked/Dosty.exe`.
- The GitHub-built Mac artifact was also downloaded, extracted into a disposable directory, and verified against the application sources, bundled artwork, licenses and strict deep code signature. The user's working installed Mac app was not replaced by these CI operations.
- Both downloaded Windows EXEs were inspected locally as archives. Each contained an `app-64.7z` payload with the x64 Dosty executable, x64 native input bridge, five Purple Cat poses, application icon and Electron/Chromium notices. The setup and portable payloads contained the identical bridge binary. This verifies payload contents, not execution of either installer/portable bootstrap on this Mac.
- A bilingual preview draft was prepared with both Windows EXEs, Mac ZIP/DMG and SHA-256 checksums. To avoid slow local uploads, a manual draft-only workflow transferred the verified artifacts within GitHub. [Staging run 42507404644](https://github.com/saido-11/Dosty/actions/runs/42507404644) passed. It validates the successful build, trusted main-branch source and matching draft source before uploading; it does not publish a release. All five remote asset sizes and available SHA-256 digests matched the downloaded build files. At this checkpoint the release remained an unpublished draft.
