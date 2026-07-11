# Bundled Crossplay plugins

Drop a prebuilt **`Crossplay.dll`** in this folder and BlockHost installs it
into TShock's `ServerPlugins/` verbatim when you start a Terraria server with
**📱 Enable mobile crossplay** ticked — instead of downloading one from GitHub
releases. This is how you turn on PC↔mobile crossplay for Terraria **1.4.5.x**
today, because that support isn't in an upstream release yet.

## Why this folder exists

The [Crossplay](https://github.com/Moneylover3246/Crossplay) plugin translates
packets so mobile/console Terraria can join a PC server through TShock. Its
newest **release** (v2.2) only supports Terraria **1.4.4.9**. Mobile devices are
locked to the latest store version (**1.4.5.6**) and can't downgrade, so the
released plugin hard-refuses to load and TShock aborts.

Support for **1.4.5.0 – 1.4.5.6** was added in
**[Crossplay PR #77](https://github.com/Moneylover3246/Crossplay/pull/77)**
(branch `nayetdet:Terraria-1.4.5+`). Until that PR is merged and released, there
is no release asset to auto-download — so the built DLL has to be supplied here.

## Where to put the file

BlockHost looks for these paths, in order (first match wins), where `<version>`
is the exact Terraria version of the server (e.g. `1.4.5.6`):

1. `plugins/<version>/Crossplay.dll`  — e.g. `plugins/1.4.5.6/Crossplay.dll`
2. `plugins/Crossplay-<version>.dll`  — e.g. `plugins/Crossplay-1.4.5.6.dll`
3. `plugins/Crossplay.dll`            — applies to any version

Use option 1 or 2 if you want to keep plugins for several Terraria versions side
by side; use option 3 for a single catch-all build.

You can also skip this folder entirely and set an environment variable to a
direct download URL:

```sh
export BLOCKHOST_CROSSPLAY_DLL_URL="https://.../Crossplay.dll"
python3 server.py
```

## How to get the 1.4.5.x `Crossplay.dll`

Pick whichever is easiest:

- **From the PR's CI build** — open
  [PR #77](https://github.com/Moneylover3246/Crossplay/pull/77), click a green
  build check → **Artifacts**, and download the compiled `Crossplay.dll`.
- **Build it yourself** (needs the .NET 6 SDK):

  ```sh
  git clone -b Terraria-1.4.5+ https://github.com/nayetdet/Crossplay.git
  cd Crossplay
  dotnet build Crossplay/Crossplay.csproj -c Release
  # -> Crossplay/bin/Release/net6.0/Crossplay.dll
  ```

- **From an upstream release**, once PR #77 is merged and a 1.4.5.x release is
  published, BlockHost will fetch it automatically and you won't need this
  folder anymore.

Then copy that `Crossplay.dll` into one of the paths above, commit it if you
want it version-controlled, and start the server. The console will log
`Crossplay plugin installed from plugins/...` and mobile players can join.

> **Heads-up:** this is a community/unreleased binary. Only use a `Crossplay.dll`
> you built yourself or obtained from a source you trust — TShock runs it as a
> server plugin with full access to your machine.
