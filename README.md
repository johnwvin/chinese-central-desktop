# Chinese Central Vanilla

A Windows desktop app for Mandarin study. It includes an offline dictionary with pinyin and stroke order, HSK review, EPUB and PDF reading, Date and Time practice, a notebook, and a built-in browser.

## Run the Windows download

1. Extract `Chinese-Central-Vanilla-Windows-x64.zip` into a writable folder.
2. Open the extracted **Chinese Central Vanilla** folder and run **Chinese Central Vanilla.exe**. Keep the other files beside it. The desktop app starts its companion server automatically.
3. If Windows asks for WebView2, install Microsoft's [Evergreen WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/#download-section), then open the app again.
4. Open **Control** to choose the folders for your own EPUB/PDF books and notebook. Press **Ctrl+F** inside a book to search its text.

The app uses a local connection at `127.0.0.1:8821`. The built-in browser uses the internet when you visit a site. Personal settings and study progress live under `%APPDATA%\Chinese Central Vanilla`. Browser data lives in the separate Vanilla WebView profile. The default book folder is `%APPDATA%\Chinese Central Vanilla\books`.

## Build from source

Install [Node.js](https://nodejs.org/) 22.12 or newer, [Go](https://go.dev/dl/) 1.26 or newer, and [Rust](https://rustup.rs/) with the Windows MSVC toolchain. Install the **Desktop development with C++** workload and Windows SDK from [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

Open PowerShell in this folder and run:

```powershell
.\build.ps1
```

The script installs the locked frontend dependencies, builds the app, and writes the Windows ZIP to `release\`. Follow the download steps above to run that package. To run the Go checks from source, use `go test ./...` from `go\`.

See [third-party notices](THIRD_PARTY_NOTICES.md) for the bundled dictionary, study data, and libraries.
