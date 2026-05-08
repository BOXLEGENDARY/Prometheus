# Step Pipeline Overview

Prometheus applies each configured step to the AST in the order listed in `Steps`.

After step application, Prometheus performs variable renaming and then unparses code.

## Registered step constructor keys

Use these exact values in `Steps[i].Name`:

- `WrapInFunction`
- `SplitStrings`
- `Vmify`
- `ConstantArray`
- `ProxifyLocals`
- `AntiTamper`
- `EncryptStrings`
- `NumbersToExpressions`
- `AddVararg`
- `WatermarkCheck`

## General step config shape

```lua
{
  Name = "Vmify",
  Settings = {}
}
```

## Notes

- Some constructor keys differ from internal human-readable names.
- You can apply the same step more than once.
- If a step returns a new AST, that AST is used for later steps.
