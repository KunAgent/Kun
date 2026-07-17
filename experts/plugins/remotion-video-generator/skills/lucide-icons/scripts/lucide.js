#!/usr/bin/env node

/**
 * Lucide Icons Skill for CodeBuddy
 * Search, download and customize Lucide icons
 */

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateReactComponent, toPascalCase } from './templates/react.template.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const METADATA_CACHE_FILE = path.join(CACHE_DIR, 'icons-metadata.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons';
const GITHUB_API_BASE = 'https://api.github.com/repos/lucide-icons/lucide/contents/icons';

// Check if lucide-static is available (for offline support)
let lucideStaticPath = null;
let lucideStaticTags = null;

async function resolveLucideStatic() {
  try {
    // Try to resolve lucide-static using import.meta.resolve
    const resolved = await import.meta.resolve('lucide-static');
    const lucideStaticDir = path.dirname(resolved);
    const iconsDir = path.join(lucideStaticDir, 'icons');
    
    await fs.access(iconsDir);
    lucideStaticPath = iconsDir;
    
    // Try to load tags for better search
    try {
      const tagsData = await fs.readFile(path.join(lucideStaticDir, 'tags.json'), 'utf-8');
      lucideStaticTags = JSON.parse(tagsData);
    } catch {
      // Tags file not available
    }
    return true;
  } catch {
    // lucide-static not installed or not resolvable
    return false;
  }
}

await resolveLucideStatic();

/**
 * Metadata Manager - handles icon metadata caching and retrieval
 */
class MetadataManager {
  constructor() {
    this.metadata = null;
  }

  async ensureCacheDir() {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async loadFromCache() {
    try {
      const stat = await fs.stat(METADATA_CACHE_FILE);
      const age = Date.now() - stat.mtimeMs;
      
      if (age < CACHE_TTL) {
        const data = await fs.readFile(METADATA_CACHE_FILE, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
      // Cache doesn't exist or is invalid
    }
    return null;
  }

  async saveToCache(metadata) {
    await this.ensureCacheDir();
    await fs.writeFile(METADATA_CACHE_FILE, JSON.stringify(metadata, null, 2));
  }

  async fetchFromLocal() {
    // Try to use local lucide-static package first
    if (lucideStaticPath) {
      const spinner = ora('Loading icons from local package...').start();
      try {
        const files = await fs.readdir(lucideStaticPath);
        const icons = files
          .filter(file => file.endsWith('.svg'))
          .map(file => {
            const name = file.replace('.svg', '');
            const tags = lucideStaticTags?.[name] || [];
            return {
              name,
              file,
              local: true,
              tags,
              category: 'general'
            };
          });
        
        spinner.succeed(`Found ${icons.length} icons (local)`);
        return { icons, fetchedAt: Date.now(), source: 'local' };
      } catch (error) {
        spinner.fail('Failed to load local icons');
      }
    }
    return null;
  }

  async fetchFromGitHub() {
    const spinner = ora('Fetching icon list from GitHub...').start();
    
    try {
      // Fetch icons directory listing
      const response = await axios.get(GITHUB_API_BASE, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'CodeBuddy-Lucide-Skill'
        },
        timeout: 10000
      });

      const icons = response.data
        .filter(item => item.name.endsWith('.svg'))
        .map(item => {
          const name = item.name.replace('.svg', '');
          return {
            name,
            file: item.name,
            downloadUrl: item.download_url,
            tags: [],
            category: 'general'
          };
        });

      spinner.succeed(`Found ${icons.length} icons`);
      return { icons, fetchedAt: Date.now(), source: 'github' };
    } catch (error) {
      spinner.fail('Failed to fetch from GitHub API');
      
      // Fallback: try to get a basic list
      try {
        spinner.start('Trying fallback method...');
        const icons = await this.fetchIconListFallback();
        spinner.succeed(`Found ${icons.length} icons (fallback)`);
        return { icons, fetchedAt: Date.now(), source: 'fallback' };
      } catch {
        spinner.fail('All methods failed');
        throw new Error('Unable to fetch icon list. Please check your internet connection.');
      }
    }
  }

  async fetchIconListFallback() {
    // Hardcoded list of common icons as fallback
    const commonIcons = [
      'activity', 'airplay', 'alert-circle', 'alert-triangle', 'archive',
      'arrow-down', 'arrow-left', 'arrow-right', 'arrow-up', 'at-sign',
      'award', 'bar-chart', 'battery', 'bell', 'bluetooth', 'bold',
      'book', 'bookmark', 'box', 'briefcase', 'calendar', 'camera',
      'check', 'check-circle', 'chevron-down', 'chevron-left', 'chevron-right',
      'chevron-up', 'circle', 'clipboard', 'clock', 'cloud', 'code',
      'coffee', 'command', 'copy', 'credit-card', 'crop', 'database',
      'delete', 'disc', 'download', 'edit', 'external-link', 'eye',
      'eye-off', 'facebook', 'fast-forward', 'file', 'file-text', 'filter',
      'flag', 'folder', 'gift', 'github', 'globe', 'grid', 'hash',
      'headphones', 'heart', 'help-circle', 'home', 'image', 'inbox',
      'info', 'instagram', 'key', 'layers', 'layout', 'link', 'list',
      'loader', 'lock', 'log-in', 'log-out', 'mail', 'map', 'map-pin',
      'maximize', 'menu', 'message-circle', 'message-square', 'mic',
      'minimize', 'minus', 'monitor', 'moon', 'more-horizontal', 'more-vertical',
      'move', 'music', 'navigation', 'package', 'paperclip', 'pause',
      'pen', 'percent', 'phone', 'pie-chart', 'play', 'plus', 'power',
      'printer', 'radio', 'refresh-cw', 'repeat', 'rewind', 'rotate-cw',
      'rss', 'save', 'scissors', 'search', 'send', 'server', 'settings',
      'share', 'shield', 'shopping-bag', 'shopping-cart', 'shuffle',
      'sidebar', 'skip-back', 'skip-forward', 'slash', 'sliders', 'smartphone',
      'speaker', 'square', 'star', 'stop-circle', 'sun', 'sunrise', 'sunset',
      'tablet', 'tag', 'target', 'terminal', 'thermometer', 'thumbs-down',
      'thumbs-up', 'toggle-left', 'toggle-right', 'trash', 'trash-2',
      'trending-down', 'trending-up', 'triangle', 'truck', 'tv', 'twitter',
      'type', 'umbrella', 'underline', 'unlock', 'upload', 'user',
      'user-check', 'user-minus', 'user-plus', 'user-x', 'users', 'video',
      'video-off', 'voicemail', 'volume', 'volume-1', 'volume-2', 'volume-x',
      'watch', 'wifi', 'wifi-off', 'wind', 'x', 'x-circle', 'youtube', 'zap',
      'zoom-in', 'zoom-out'
    ];

    return commonIcons.map(name => ({
      name,
      file: `${name}.svg`,
      downloadUrl: `${GITHUB_RAW_BASE}/${name}.svg`,
      tags: [],
      category: 'general'
    }));
  }

  async getMetadata(forceRefresh = false) {
    if (this.metadata && !forceRefresh) {
      return this.metadata;
    }

    if (!forceRefresh) {
      const cached = await this.loadFromCache();
      if (cached) {
        this.metadata = cached;
        return cached;
      }
    }

    // Try local package first, then GitHub
    let metadata = await this.fetchFromLocal();
    if (!metadata) {
      metadata = await this.fetchFromGitHub();
    }
    
    await this.saveToCache(metadata);
    this.metadata = metadata;
    return metadata;
  }

  async search(query, limit = 20) {
    const metadata = await this.getMetadata();
    const queryLower = query.toLowerCase();
    
    const results = metadata.icons
      .map(icon => {
        let score = 0;
        const nameLower = icon.name.toLowerCase();
        
        // Exact match
        if (nameLower === queryLower) {
          score = 100;
        }
        // Starts with query
        else if (nameLower.startsWith(queryLower)) {
          score = 80;
        }
        // Contains query
        else if (nameLower.includes(queryLower)) {
          score = 60;
        }
        // Word boundary match
        else if (nameLower.split('-').some(word => word.startsWith(queryLower))) {
          score = 40;
        }
        // Tag match (if available)
        else if (icon.tags?.some(tag => tag.toLowerCase().includes(queryLower))) {
          score = 30;
        }
        
        return { ...icon, score };
      })
      .filter(icon => icon.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  async getIcon(name) {
    const metadata = await this.getMetadata();
    return metadata.icons.find(icon => icon.name === name);
  }

  async listAll() {
    const metadata = await this.getMetadata();
    return metadata.icons;
  }
}

/**
 * Icon Downloader - handles SVG downloading and customization
 */
class IconDownloader {
  constructor() {
    this.metadataManager = new MetadataManager();
  }

  async downloadSvg(iconName) {
    // Try local lucide-static first (if available)
    if (lucideStaticPath) {
      try {
        const localPath = path.join(lucideStaticPath, `${iconName}.svg`);
        const content = await fs.readFile(localPath, 'utf-8');
        return content;
      } catch {
        // Fall through to GitHub
      }
    }

    // Try GitHub raw content
    const url = `${GITHUB_RAW_BASE}/${iconName}.svg`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'CodeBuddy-Lucide-Skill'
        },
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Icon "${iconName}" not found`);
      }
      throw new Error(`Failed to download icon: ${error.message}`);
    }
  }

  toIconKey(iconName) {
    // Convert kebab-case to camelCase
    return iconName
      .split('-')
      .map((word, index) => 
        index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
      )
      .join('');
  }

  customizeSvg(svgContent, options = {}) {
    const { color, size, strokeWidth } = options;
    let result = svgContent;

    if (size) {
      result = result
        .replace(/width="[^"]*"/, `width="${size}"`)
        .replace(/height="[^"]*"/, `height="${size}"`);
    }

    if (strokeWidth) {
      result = result.replace(/stroke-width="[^"]*"/g, `stroke-width="${strokeWidth}"`);
    }

    if (color) {
      result = result.replace(/stroke="currentColor"/g, `stroke="${color}"`);
      // Also handle fill if it's set to currentColor
      result = result.replace(/fill="currentColor"/g, `fill="${color}"`);
    }

    return result;
  }
}

/**
 * File Manager - handles file operations
 */
class FileManager {
  async ensureDir(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async writeFile(filePath, content, overwrite = false) {
    const exists = await this.fileExists(filePath);
    
    if (exists && !overwrite) {
      throw new Error(`File already exists: ${filePath}. Use --overwrite to replace.`);
    }

    await this.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf-8');
  }
}

// Initialize managers
const metadataManager = new MetadataManager();
const iconDownloader = new IconDownloader();
const fileManager = new FileManager();

// CLI Program
program
  .name('lucide')
  .description('Search, download and customize Lucide icons')
  .version('1.0.0');

// Search command
program
  .command('search <keyword>')
  .description('Search for icons by name or keyword')
  .option('-l, --limit <number>', 'Maximum number of results', '20')
  .option('--json', 'Output as JSON')
  .action(async (keyword, options) => {
    try {
      const limit = parseInt(options.limit, 10);
      const results = await metadataManager.search(keyword, limit);

      if (results.length === 0) {
        console.log(chalk.yellow(`No icons found matching "${keyword}"`));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log(chalk.cyan(`\n  Search results for "${keyword}" (${results.length} found):\n`));
      
      results.forEach((icon, index) => {
        const num = chalk.gray(`${(index + 1).toString().padStart(3)}.`);
        const name = chalk.white(icon.name);
        const tags = icon.tags?.length ? chalk.gray(` (${icon.tags.slice(0, 3).join(', ')})`) : '';
        console.log(`  ${num} ${name}${tags}`);
      });

      console.log(chalk.gray(`\n  Use 'lucide download <icon-name>' to download an icon\n`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Download command
program
  .command('download <icon-name>')
  .description('Download an icon')
  .option('-o, --output <dir>', 'Output directory', '.')
  .option('-f, --format <formats>', 'Output formats: svg,react', 'svg')
  .option('-c, --color <color>', 'Icon color', 'currentColor')
  .option('-s, --size <size>', 'Icon size in pixels', '24')
  .option('-w, --stroke-width <width>', 'Stroke width', '2')
  .option('--overwrite', 'Overwrite existing files')
  .option('--json', 'Output as JSON')
  .action(async (iconName, options) => {
    const spinner = ora('Downloading icon...').start();
    
    try {
      // Normalize icon name
      const normalizedName = iconName.toLowerCase().trim();
      
      // Download SVG
      let svgContent = await iconDownloader.downloadSvg(normalizedName);
      
      // Apply customizations
      svgContent = iconDownloader.customizeSvg(svgContent, {
        color: options.color !== 'currentColor' ? options.color : null,
        size: options.size !== '24' ? options.size : null,
        strokeWidth: options.strokeWidth !== '2' ? options.strokeWidth : null
      });

      const formats = options.format.split(',').map(f => f.trim().toLowerCase());
      const outputDir = path.resolve(options.output);
      const savedFiles = [];

      // Save SVG
      if (formats.includes('svg')) {
        const svgPath = path.join(outputDir, `${normalizedName}.svg`);
        await fileManager.writeFile(svgPath, svgContent, options.overwrite);
        savedFiles.push({ type: 'svg', path: svgPath });
      }

      // Generate and save React component
      if (formats.includes('react')) {
        const componentCode = generateReactComponent(normalizedName, svgContent);
        const componentName = toPascalCase(normalizedName) + 'Icon';
        const reactPath = path.join(outputDir, `${componentName}.tsx`);
        await fileManager.writeFile(reactPath, componentCode, options.overwrite);
        savedFiles.push({ type: 'react', path: reactPath });
      }

      spinner.succeed('Download complete!');

      if (options.json) {
        console.log(JSON.stringify({ icon: normalizedName, files: savedFiles }, null, 2));
        return;
      }

      console.log(chalk.green('\n  Saved files:'));
      savedFiles.forEach(file => {
        const icon = file.type === 'svg' ? '  ' : '  ';
        console.log(chalk.white(`  ${icon} ${file.path}`));
      });
      console.log();

    } catch (error) {
      spinner.fail('Download failed');
      console.error(chalk.red(`\n  Error: ${error.message}\n`));
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .description('List all available icons')
  .option('--json', 'Output as JSON')
  .option('-l, --limit <number>', 'Maximum number of results', '50')
  .option('--offset <number>', 'Skip first N results', '0')
  .action(async (options) => {
    try {
      const icons = await metadataManager.listAll();
      const limit = parseInt(options.limit, 10);
      const offset = parseInt(options.offset, 10);
      const paged = icons.slice(offset, offset + limit);

      if (options.json) {
        console.log(JSON.stringify({
          total: icons.length,
          offset,
          limit,
          icons: paged
        }, null, 2));
        return;
      }

      console.log(chalk.cyan(`\n  Available icons (${offset + 1}-${offset + paged.length} of ${icons.length}):\n`));
      
      paged.forEach((icon, index) => {
        const num = chalk.gray(`${(offset + index + 1).toString().padStart(4)}.`);
        console.log(`  ${num} ${icon.name}`);
      });

      if (offset + limit < icons.length) {
        console.log(chalk.gray(`\n  Use --offset ${offset + limit} to see more icons\n`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Info command
program
  .command('info <icon-name>')
  .description('Show detailed information about an icon')
  .option('--json', 'Output as JSON')
  .action(async (iconName, options) => {
    try {
      const normalizedName = iconName.toLowerCase().trim();
      const icon = await metadataManager.getIcon(normalizedName);

      if (!icon) {
        // Try to download it to verify it exists
        try {
          await iconDownloader.downloadSvg(normalizedName);
        } catch {
          console.error(chalk.red(`Icon "${iconName}" not found`));
          process.exit(1);
        }
      }

      const info = {
        name: normalizedName,
        componentName: toPascalCase(normalizedName) + 'Icon',
        downloadUrl: `${GITHUB_RAW_BASE}/${normalizedName}.svg`,
        lucideUrl: `https://lucide.dev/icons/${normalizedName}`,
        tags: icon?.tags || [],
        category: icon?.category || 'general'
      };

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      console.log(chalk.cyan(`\n  Icon: ${chalk.white(info.name)}\n`));
      console.log(`  ${chalk.gray('Component:')}  ${info.componentName}`);
      console.log(`  ${chalk.gray('Category:')}   ${info.category}`);
      if (info.tags.length > 0) {
        console.log(`  ${chalk.gray('Tags:')}       ${info.tags.join(', ')}`);
      }
      console.log(`  ${chalk.gray('Lucide URL:')} ${chalk.blue(info.lucideUrl)}`);
      console.log();
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Refresh cache command
program
  .command('refresh')
  .description('Refresh the icon metadata cache')
  .action(async () => {
    const spinner = ora('Refreshing icon cache...').start();
    try {
      await metadataManager.getMetadata(true);
      spinner.succeed('Cache refreshed successfully');
    } catch (error) {
      spinner.fail(`Failed to refresh cache: ${error.message}`);
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
