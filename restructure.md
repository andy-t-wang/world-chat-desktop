# Monorepo Restructure Plan

## Current Problem
- Two separate repos: `world-chat-web` and `world-chat-desktop`
- Desktop uses web as a git submodule
- Changes require: commit to web → update submodule in desktop → commit desktop
- Easy to get out of sync, painful to maintain

## Proposed Structure

```
world-chat/
├── package.json              # workspace root
├── pnpm-workspace.yaml
├── apps/
│   ├── web/                  # Next.js app (current world-chat-web)
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── stores/
│   │   ├── package.json
│   │   └── ...
│   └── desktop/              # Electron wrapper only
│       ├── electron/
│       │   ├── main.ts
│       │   └── preload.ts
│       ├── resources/
│       │   └── translation/
│       │       └── translate.py
│       ├── package.json
│       └── electron-builder.yml
├── packages/                 # Optional: shared code
│   └── shared/
│       └── types/
└── .github/
    └── workflows/
```

## Benefits
- Single commit updates both web and desktop
- No submodule sync headaches
- Shared dependencies via pnpm workspaces
- Single `pnpm dev` can start both apps
- Easier CI/CD

## pnpm-workspace.yaml
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

## Root package.json scripts
```json
{
  "scripts": {
    "dev": "pnpm -r dev",
    "dev:web": "pnpm --filter web dev",
    "dev:desktop": "pnpm --filter desktop dev",
    "build": "pnpm -r build",
    "build:web": "pnpm --filter web build",
    "build:desktop": "pnpm --filter desktop build"
  }
}
```

## Desktop Electron Behavior
- **Dev mode**: Loads `http://localhost:3000` (web app dev server)
- **Production**: Loads deployed URL `https://world-chat-web.vercel.app`
- Electron is just a wrapper - no need to bundle the web app

## Migration Steps
1. Create new `world-chat` monorepo
2. Move `world-chat-web` contents to `apps/web/`
3. Move desktop Electron files to `apps/desktop/`
4. Set up pnpm workspaces
5. Update imports/paths as needed
6. Test dev and build workflows
7. Update CI/CD pipelines
8. Archive old repos

## Alternative: Simpler Approach
If monorepo is too much overhead, the desktop app could simply:
- Always load the deployed web URL (even in dev for testing)
- Use ngrok for local testing when needed
- Keep repos separate but remove the submodule entirely
