# Installation

## Linux and macOS (recommended)

Install the latest release:

```bash
curl -fsSL https://raw.githubusercontent.com/prometheus-lua/Prometheus/master/install.sh | sh
```

Verify:

```bash
prometheus-lua --version
```

Release bundles include a Lua runtime, so no separate Lua install is needed for installed CLI usage.

Update later:

```bash
prometheus-lua update
```

## From source

```bash
git clone "https://github.com/prometheus-lua/Prometheus.git"
cd Prometheus
./prometheus-lua --preset Medium ./your_file.lua
```

For source usage, Prometheus requires LuaJIT or Lua 5.1+.
