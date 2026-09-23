import * as path from 'path';
import * as fs from 'fs';
import nunjucks from 'nunjucks';
import puppeteer from 'puppeteer';

// ============================================================
// Types
// ============================================================

export interface RenderOptions {
  templateName: string;
  data: Record<string, unknown>;
  outputPath?: string;
  theme?: string;
}

export interface RenderResult {
  path: string;
  pageCount: number;
  sizeBytes: number;
}

// ============================================================
// Template Resolution
// ============================================================

const TEMPLATE_MAP: Record<string, { path: string; game: string; defaultTheme: string }> = {
  'the-album': {
    path: 'confession-album/the-album.njk',
    game: 'confession-album',
    defaultTheme: 'confession-album',
  },
  'prousts-answer': {
    path: 'confession-album/prousts-answer.njk',
    game: 'confession-album',
    defaultTheme: 'personal-letter',
  },
  'contributions-table': {
    path: 'confession-album/contributions-table.njk',
    game: 'confession-album',
    defaultTheme: 'confession-album',
  },
  'the-dossier': {
    path: 'murder-mystery/the-dossier.njk',
    game: 'murder-mystery',
    defaultTheme: 'murder-mystery',
  },
  'menu-of-the-damned': {
    path: 'murder-mystery/menu-of-the-damned.njk',
    game: 'murder-mystery',
    defaultTheme: 'murder-mystery',
  },
  'the-sealed-envelope': {
    path: 'murder-mystery/the-sealed-envelope.njk',
    game: 'murder-mystery',
    defaultTheme: 'personal-letter',
  },
};

export function getTemplateInfo(name: string) {
  const info = TEMPLATE_MAP[name];
  if (!info) {
    const valid = Object.keys(TEMPLATE_MAP).join(', ');
    throw new Error(`Unknown template "${name}". Valid templates: ${valid}`);
  }
  return info;
}

export function getAllTemplateNames(): string[] {
  return Object.keys(TEMPLATE_MAP);
}

// ============================================================
// Nunjucks Filters
// ============================================================

function dateFormat(dateStr: string, fmt?: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  if (fmt === 'short') {
    return `${date.getDate()} ${months[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`;
  }

  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function truncate(str: string, len: number): string {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.slice(0, len).trimEnd() + '…';
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function initials(name: string): string {
  if (!name) return '';
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function markdown(str: string): string {
  if (!str) return '';
  return str
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// ============================================================
// Nunjucks Environment
// ============================================================

function createNunjucksEnv(): nunjucks.Environment {
  const templatesDir = path.resolve(__dirname, '..', 'templates');
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(templatesDir, { noCache: true }),
    { autoescape: true, trimBlocks: true, lstripBlocks: true }
  );

  env.addFilter('dateFormat', dateFormat);
  env.addFilter('truncate', truncate);
  env.addFilter('ordinal', ordinal);
  env.addFilter('markdown', markdown);

  env.addGlobal('initials', initials);
  env.addGlobal('ordinal', ordinal);

  return env;
}

// ============================================================
// HTML Rendering
// ============================================================

export function renderHTML(templateName: string, data: Record<string, unknown>): string {
  const env = createNunjucksEnv();
  const info = getTemplateInfo(templateName);
  const theme = (data.theme as string) || info.defaultTheme;

  const renderData = { ...data, theme };
  return env.render(info.path, renderData);
}

// ============================================================
// CSS Path Resolution for Puppeteer
// ============================================================

function inlineCSS(html: string): string {
  const designSystemDir = path.resolve(__dirname, '..', 'design-system');

  const cssFiles = ['reset.css', 'tokens.css', 'typography.css', 'layout.css', 'textures.css'];
  let combinedCSS = '';

  for (const file of cssFiles) {
    const cssPath = path.join(designSystemDir, file);
    if (fs.existsSync(cssPath)) {
      combinedCSS += fs.readFileSync(cssPath, 'utf-8') + '\n';
    }
  }

  // Replace link tags with inline styles
  const linkPattern = /<link\s+rel="stylesheet"\s+href="\.\.\/design-system\/[^"]+"\s*\/?>/g;
  let result = html.replace(linkPattern, '');

  // Insert combined CSS in <head>
  result = result.replace('</head>', `<style>${combinedCSS}</style>\n</head>`);

  return result;
}

// ============================================================
// PDF Rendering
// ============================================================

export async function renderPDF(options: RenderOptions): Promise<RenderResult> {
  const { templateName, data, theme } = options;
  const info = getTemplateInfo(templateName);

  // Resolve output path
  const outputDir = path.resolve(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = options.outputPath || path.join(outputDir, `${templateName}.pdf`);

  // Render HTML
  const renderData = { ...data, theme: theme || info.defaultTheme };
  let html = renderHTML(templateName, renderData);

  // Inline CSS for Puppeteer (no relative path resolution in setContent)
  html = inlineCSS(html);

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    await page.pdf({
      path: outputPath,
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
    });

    // Get file info
    const stats = fs.statSync(outputPath);

    // Estimate page count from file size (rough; Puppeteer doesn't expose page count directly)
    // A more accurate count would require pdf-lib or similar
    const estimatedPages = Math.max(1, Math.ceil(stats.size / 50000));

    return {
      path: outputPath,
      pageCount: estimatedPages,
      sizeBytes: stats.size,
    };
  } finally {
    await browser.close();
  }
}
