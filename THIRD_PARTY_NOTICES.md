# Third-party notices

Dosty's original source code and bundled project artwork are licensed under
GPL-3.0-only; see [LICENSE](LICENSE). Third-party components retain their own licenses.

Packaged applications include Electron and Chromium. Their notices are shipped
in the application's `Contents/Resources` directory on macOS, or alongside the
application executable on Windows:

- `LICENSE.electron.txt`: Electron's MIT license.
- `LICENSES.chromium.html`: Chromium and included third-party component notices.

The application has no production npm dependencies. Development and packaging
tools are listed with their resolved versions and license identifiers in
`package-lock.json`; their license files remain in their respective npm packages.
The package verifier checks that the application license and bundled Electron /
Chromium notices are present.
