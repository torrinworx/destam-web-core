# destam-web-core/server

## Modules

The server is composed from small feature modules.

- **Discovery**: modules are discovered by recursively scanning one or more directories for `.js` files.
  - Each file becomes a module name based on its path, e.g. `modules/posts/Create.js` -> `posts/Create`.
  - Files that lack a default module factory export are skipped, so helper `.js` utilities can live alongside real modules without being loaded.
- **Dependencies**: a module can declare `export const deps = ['other/module', ...]`.
  - Modules are loaded in dependency order.
- **Factory**: a module must `export default (injection) => ({ ...handlers })`.
  - The `injection` includes shared server resources (e.g. `odb`, `server`, `env`) and `webCore` metadata.
  - Dependencies are injected by *short name* (last path segment). Example: dep `moderation/strings` injects `strings`.

### What A Module Can Do

Modules are intentionally flexible; they can provide any subset of:

- `onMsg(props, ctx)`: handle websocket messages where `msg.name === '<moduleName>'`
- `onCon(ctx)`: run when a client connects (optionally gated by auth)
- `validate`: register database validators
- `schedule`: register scheduled jobs
- `authenticated: false`: mark the module as callable without authentication

## Configuration (`moduleConfig`)

When starting the server, pass a `moduleConfig` object keyed by module name:

```js
core({
  // ...
  moduleConfig: {
    'posts/Create': {
      description: { maxLength: 5000 },
      tags: false,
    },
  },
});
```

- **Defaults**: a module may export `export const defaults = { ... }`.
- **Merging**: effective config is `deepMerge(defaults, moduleConfig[name])`.
  - Objects merge recursively; non-objects replace.
- **Disable entirely**: set `moduleConfig[name] = false` to prevent the module from loading at all (it is not imported).
  - If another module depends on a disabled module, startup fails with a clear dependency error.
