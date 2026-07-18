# Social Media Sidebar

Product-owned browser-only Kun extension for viewing Douyin, Bilibili, and Xiaohongshu in the Code right sidebar.

The local shell owns platform switching and browser controls. Remote pages run in a separate sandboxed Webview without the Kun extension preload. Main restricts top-level navigation to the reviewed `network:*` grants, denies device permissions and downloads, and stores cookies only in an extension-specific partition.

```bash
npm run typecheck
npm test
npm run build
npm run validate
```

Availability still depends on the selected website, network, region, and its current Electron/browser support. The extension does not bypass authentication, DRM, anti-bot, or service restrictions.
