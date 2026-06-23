# Installing the Kilo CLI

The Kilo CLI (`@kilocode/cli`) can be installed with whichever package
manager or method best fits your environment. Pick one of the options below.

## Quick install (curl)

The fastest way to get started on macOS or Linux:

```bash
curl -fsSL https://kilo.ai/cli/install | bash
```

## Package managers

### npm

```bash
npm install -g @kilocode/cli
```

### pnpm

```bash
pnpm add -g @kilocode/cli
```

### bun

```bash
bun add -g @kilocode/cli
```

## Platform packages

### Homebrew (macOS / Linux)

```bash
brew install Kilo-Org/tap/kilo
```

### Arch Linux (AUR)

```bash
paru -S kilo-bin
```

## Verifying the installation

After installing with any of the methods above, confirm the CLI is on your
`PATH`:

```bash
kilo --version
```
