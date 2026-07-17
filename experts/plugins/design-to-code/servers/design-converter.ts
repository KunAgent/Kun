#!/usr/bin/env node
/**
 * Design to Code MCP Server
 * Converts Figma designs and screenshots to code components
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const ParseFigmaSchema = z.object({
  json: z.string().describe('Figma JSON export'),
  framework: z.enum(['react', 'svelte', 'vue']).default('react')
});

const AnalyzeScreenshotSchema = z.object({
  imagePath: z.string().describe('Path to screenshot'),
  framework: z.enum(['react', 'svelte', 'vue']).default('react')
});

const GenerateComponentSchema = z.object({
  layout: z.object({
    type: z.string(),
    children: z.array(z.any()).optional(),
    styles: z.record(z.string()).optional()
  }),
  framework: z.enum(['react', 'svelte', 'vue']).default('react'),
  includeA11y: z.boolean().default(true)
});

async function parseFigma(args: z.infer<typeof ParseFigmaSchema>) {
  const { json: figmaJson, framework } = args;
  const data = JSON.parse(figmaJson);

  return {
    framework,
    components: extractComponents(data),
    colors: extractColors(data),
    typography: extractTypography(data)
  };
}

function extractComponents(data: any): any[] {
  // Simplified component extraction
  return [{
    name: data.name || 'Component',
    type: data.type || 'FRAME',
    width: data.absoluteBoundingBox?.width || 0,
    height: data.absoluteBoundingBox?.height || 0
  }];
}

function extractColors(data: any): string[] {
  return ['#000000', '#FFFFFF']; // Simplified
}

function extractTypography(data: any): any[] {
  return [{ family: 'Inter', size: 16, weight: 400 }]; // Simplified
}

async function analyzeScreenshot(args: z.infer<typeof AnalyzeScreenshotSchema>) {
  const { imagePath, framework } = args;

  return {
    framework,
    layout: {
      type: 'container',
      children: [
        { type: 'text', content: 'Heading' },
        { type: 'button', label: 'Click Me' }
      ]
    }
  };
}

async function generateComponent(args: z.infer<typeof GenerateComponentSchema>) {
  const { layout, framework, includeA11y } = args;

  let code = '';

  if (framework === 'react') {
    code = generateReactComponent(layout, includeA11y);
  } else if (framework === 'svelte') {
    code = generateSvelteComponent(layout, includeA11y);
  } else {
    code = generateVueComponent(layout, includeA11y);
  }

  return { code, framework, a11yCompliant: includeA11y };
}

function generateReactComponent(layout: any, includeA11y: boolean): string {
  return `
import React from 'react';

export default function Component() {
  return (
    <div ${includeA11y ? 'role="region" aria-label="Component"' : ''}>
      <h1>Generated Component</h1>
      <button ${includeA11y ? 'aria-label="Action button"' : ''}>
        Click Me
      </button>
    </div>
  );
}
`.trim();
}

function generateSvelteComponent(layout: any, includeA11y: boolean): string {
  return `
<div ${includeA11y ? 'role="region" aria-label="Component"' : ''}>
  <h1>Generated Component</h1>
  <button ${includeA11y ? 'aria-label="Action button"' : ''}>Click Me</button>
</div>
`.trim();
}

function generateVueComponent(layout: any, includeA11y: boolean): string {
  return `
<template>
  <div ${includeA11y ? 'role="region" aria-label="Component"' : ''}>
    <h1>Generated Component</h1>
    <button ${includeA11y ? 'aria-label="Action button"' : ''}>Click Me</button>
  </div>
</template>
`.trim();
}

const server = new Server({ name: 'design-converter', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'parse_figma', description: 'Parse Figma JSON export', inputSchema: zodToJsonSchema(ParseFigmaSchema) as Tool['inputSchema'] },
    { name: 'analyze_screenshot', description: 'Analyze screenshot layout', inputSchema: zodToJsonSchema(AnalyzeScreenshotSchema) as Tool['inputSchema'] },
    { name: 'generate_component', description: 'Generate code component', inputSchema: zodToJsonSchema(GenerateComponentSchema) as Tool['inputSchema'] }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    if (name === 'parse_figma') result = await parseFigma(ParseFigmaSchema.parse(args));
    else if (name === 'analyze_screenshot') result = await analyzeScreenshot(AnalyzeScreenshotSchema.parse(args));
    else if (name === 'generate_component') result = await generateComponent(GenerateComponentSchema.parse(args));
    else throw new Error(`Unknown tool: ${name}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) }], isError: true };
  }
});

async function main() {
  await server.connect(new StdioServerTransport());
  console.error('Design Converter MCP server running');
}

main().catch(err => { console.error(err); process.exit(1); });
