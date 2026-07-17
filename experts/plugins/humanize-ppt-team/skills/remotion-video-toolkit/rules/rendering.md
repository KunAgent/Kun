---
name: rendering
description: Rendering videos with Remotion - CLI, Node.js API, Lambda, and Cloud Run
metadata:
  tags: render, cli, lambda, cloud-run, server, output, mp4, webm, gif
---

# Rendering Videos

## CLI Rendering

Render a composition to a video file:

```bash
npx remotion render src/index.ts MyComposition out/video.mp4
```

### Common flags

```bash
# Set output format
npx remotion render src/index.ts MyComp out.mp4 --codec h264
npx remotion render src/index.ts MyComp out.webm --codec vp8
npx remotion render src/index.ts MyComp out.gif --codec gif

# Set resolution and frame range
npx remotion render src/index.ts MyComp out.mp4 --width 1080 --height 1920
npx remotion render src/index.ts MyComp out.mp4 --frames 0-100

# Increase quality / CRF (lower = better, default 18)
npx remotion render src/index.ts MyComp out.mp4 --crf 15

# Concurrency (parallel frames)
npx remotion render src/index.ts MyComp out.mp4 --concurrency 4

# Pass input props as JSON
npx remotion render src/index.ts MyComp out.mp4 --props '{"title": "Hello"}'

# Or from a file
npx remotion render src/index.ts MyComp out.mp4 --props ./props.json
```

### Render a still image

```bash
npx remotion still src/index.ts MyStill out.png
npx remotion still src/index.ts MyStill out.png --frame 30
```

### Available codecs

| Codec | Extension | Use case |
|-------|-----------|----------|
| `h264` | .mp4 | Default, best compatibility |
| `h265` | .mp4 | Smaller files, less compatibility |
| `vp8` | .webm | Web, transparent video |
| `vp9` | .webm | Better quality WebM |
| `prores` | .mov | Professional editing (Apple ProRes) |
| `gif` | .gif | Short loops, social media |

## Node.js API Rendering

For server-side rendering, use the `@remotion/renderer` package:

```tsx
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";

const render = async () => {
  // Bundle the project
  const bundled = await bundle({
    entryPoint: path.resolve("./src/index.ts"),
  });

  // Select the composition
  const composition = await selectComposition({
    serveUrl: bundled,
    id: "MyComposition",
    inputProps: {
      title: "Hello World",
    },
  });

  // Render
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: "out/video.mp4",
    inputProps: {
      title: "Hello World",
    },
    onProgress: ({ progress }) => {
      console.log(`Rendering: ${(progress * 100).toFixed(1)}%`);
    },
  });
};

render();
```

### Render a still frame

```tsx
import { renderStill } from "@remotion/renderer";

await renderStill({
  composition,
  serveUrl: bundled,
  output: "out/thumbnail.png",
  frame: 0,
  inputProps: { title: "Thumbnail" },
});
```

### Render to a buffer (no file)

```tsx
import { renderMedia } from "@remotion/renderer";

const result = await renderMedia({
  composition,
  serveUrl: bundled,
  codec: "h264",
  outputLocation: null, // No file output
});

// result.buffer contains the video as a Buffer
```

## AWS Lambda Rendering

For serverless rendering at scale. Install the Lambda package:

```bash
npx remotion lambda policies role
npx remotion lambda sites create src/index.ts --site-name=my-site
npx remotion lambda functions deploy
```

Render from code:

```tsx
import { renderMediaOnLambda } from "@remotion/lambda/client";

const result = await renderMediaOnLambda({
  region: "us-east-1",
  functionName: "remotion-render-...",
  serveUrl: "https://...", // from sites create
  composition: "MyComposition",
  codec: "h264",
  inputProps: {
    title: "Dynamic Video",
  },
});

// result.outputFile - S3 URL of rendered video
```

### Lambda considerations

- Max 15 min per render (AWS limit)
- Splits video into chunks, renders in parallel, stitches
- Cost-effective for burst workloads
- Use `@remotion/lambda` for the full API

## Google Cloud Run Rendering

Alternative to Lambda using Cloud Run:

```bash
npx remotion cloudrun services deploy
npx remotion cloudrun sites create src/index.ts
```

```tsx
import { renderMediaOnCloudrun } from "@remotion/cloudrun/client";

const result = await renderMediaOnCloudrun({
  serviceName: "remotion-render",
  region: "us-east-1",
  serveUrl: "https://storage.googleapis.com/...",
  composition: "MyComposition",
  codec: "h264",
  inputProps: { title: "Hello" },
});
```

## Express/HTTP Server Pattern

Expose rendering as an API endpoint:

```tsx
import express from "express";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";

const app = express();
app.use(express.json());

// Bundle once at startup
let bundled: string;
bundle({ entryPoint: path.resolve("./src/index.ts") }).then((b) => {
  bundled = b;
  console.log("Bundled and ready");
});

app.post("/render", async (req, res) => {
  const { compositionId, props } = req.body;

  const composition = await selectComposition({
    serveUrl: bundled,
    id: compositionId,
    inputProps: props,
  });

  const result = await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: null,
    inputProps: props,
  });

  res.set("Content-Type", "video/mp4");
  res.send(result.buffer);
});

app.listen(3000);
```

## Performance Tips

- **Concurrency**: Use `--concurrency` to render frames in parallel (default: 50% of CPU cores)
- **Bundle once**: In server scenarios, call `bundle()` once and reuse the URL
- **Use `calculateMetadata`**: Pre-compute heavy data before rendering starts
- **Avoid network calls in components**: Fetch data via `inputProps` or `calculateMetadata` instead
- **Image optimization**: Pre-resize images to the exact dimensions needed
- **Memory**: For long videos, consider splitting into segments and concatenating
