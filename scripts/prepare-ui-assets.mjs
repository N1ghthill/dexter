#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const inputDir = path.join(repoRoot, 'assets', 'novos_assets');
const mascotOutDir = path.join(repoRoot, 'assets', 'illustrations', 'mascot');
const iconOutDir = path.join(repoRoot, 'assets', 'icons', 'linux');
const manifestPath = path.join(mascotOutDir, 'manifest.json');

const NAME_MAP = new Map([
  ['17_31_52', 'chemist-pour'],
  ['17_34_01', 'victory-fist'],
  ['17_35_24', 'grin-crouch'],
  ['17_38_25', 'pointing-up'],
  ['17_40_00', 'gadget-blaster'],
  ['17_42_02', 'hero-grin']
]);

const ICON_SOURCE_STEM = 'hero-grin';
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const UI_VARIANT_SIZES = [320, 512];

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `\n${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function ensureMagick() {
  try {
    run('magick', ['-version']);
  } catch (error) {
    throw new Error(`ImageMagick (magick) is required to prepare UI assets.\n${String(error)}`);
  }
}

function identifySize(filePath) {
  const raw = run('magick', ['identify', '-format', '%w %h', filePath]);
  const [width, height] = raw.split(/\s+/).map((value) => Number.parseInt(value, 10));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Unable to identify image size for ${filePath}`);
  }
  return { width, height };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function deriveStem(fileName, index) {
  for (const [token, stem] of NAME_MAP.entries()) {
    if (fileName.includes(token)) {
      return stem;
    }
  }
  return `mascot-${String(index + 1).padStart(2, '0')}`;
}

function cleanBackground(inputPath, outputPath) {
  const { width, height } = identifySize(inputPath);
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1]
  ];
  const args = [inputPath, '-alpha', 'set', '-channel', 'rgba', '-fuzz', '8%', '-fill', 'none'];
  for (const [x, y] of corners) {
    args.push('-draw', `color ${x},${y} floodfill`);
  }
  args.push(
    '+channel',
    '-trim',
    '+repage',
    '-define',
    'png:compression-level=9',
    outputPath
  );
  run('magick', args);
}

function makeCanvasSquare(inputPath, outputPath, size = 1024) {
  run('magick', [
    '-size',
    `${size}x${size}`,
    'xc:none',
    '(',
    inputPath,
    '-resize',
    `${Math.round(size * 0.84)}x${Math.round(size * 0.84)}>`,
    ')',
    '-gravity',
    'center',
    '-compose',
    'over',
    '-composite',
    '-define',
    'png:compression-level=9',
    outputPath
  ]);
}

function generateUiVariants(canvasPath, stem) {
  const outputs = [];
  for (const size of UI_VARIANT_SIZES) {
    const pngPath = path.join(mascotOutDir, `${stem}-ui-${size}.png`);
    const webpPath = path.join(mascotOutDir, `${stem}-ui-${size}.webp`);

    run('magick', [
      canvasPath,
      '-resize',
      `${size}x${size}`,
      '-filter',
      'Lanczos',
      '-define',
      'png:compression-level=9',
      pngPath
    ]);

    run('magick', [
      canvasPath,
      '-resize',
      `${size}x${size}`,
      '-quality',
      '88',
      webpPath
    ]);

    outputs.push({
      size,
      png: path.relative(repoRoot, pngPath),
      webp: path.relative(repoRoot, webpPath)
    });
  }
  return outputs;
}

function buildIconSet(iconSourcePath) {
  ensureDir(iconOutDir);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-ui-icons-'));
  const iconMaster = path.join(tmpDir, 'dexter-icon-master-1024.png');

  run('magick', [
    '-size',
    '1024x1024',
    'xc:none',
    '(',
    '-size',
    '1024x1024',
    'xc:none',
    '-fill',
    '#0f2f63',
    '-draw',
    'circle 512,512 512,86',
    ')',
    '(',
    '-size',
    '1024x1024',
    'xc:none',
    '-fill',
    '#10203acc',
    '-draw',
    'circle 512,568 512,110',
    '-blur',
    '0x18',
    ')',
    '-compose',
    'over',
    '-composite',
    '(',
    '-size',
    '1024x1024',
    'xc:none',
    '-fill',
    'none',
    '-stroke',
    '#173868',
    '-strokewidth',
    '28',
    '-draw',
    'circle 512,512 512,88',
    ')',
    '-compose',
    'over',
    '-composite',
    '(',
    '-size',
    '1024x1024',
    'xc:none',
    '-fill',
    'none',
    '-stroke',
    '#73e2ffcc',
    '-strokewidth',
    '16',
    '-draw',
    'circle 512,512 512,98',
    ')',
    '-compose',
    'over',
    '-composite',
    '(',
    '-size',
    '1024x1024',
    'xc:none',
    '-fill',
    '#2a5fb5',
    '-draw',
    'circle 385,325 385,215',
    '-blur',
    '0x26',
    ')',
    '-compose',
    'over',
    '-composite',
    '(',
    iconSourcePath,
    '-resize',
    '700x700>',
    ')',
    '-gravity',
    'center',
    '-geometry',
    '+0+58',
    '-compose',
    'over',
    '-composite',
    '-define',
    'png:compression-level=9',
    iconMaster
  ]);

  const generated = [];
  for (const size of ICON_SIZES) {
    const fileName = `${size}x${size}.png`;
    const outPath = path.join(iconOutDir, fileName);
    run('magick', [
      iconMaster,
      '-resize',
      `${size}x${size}`,
      '-filter',
      'Lanczos',
      '-define',
      'png:compression-level=9',
      outPath
    ]);
    generated.push(path.relative(repoRoot, outPath));
  }

  const windowIconPath = path.join(iconOutDir, 'window.png');
  run('magick', [iconMaster, '-resize', '256x256', '-define', 'png:compression-level=9', windowIconPath]);
  generated.push(path.relative(repoRoot, windowIconPath));

  const masterOutPath = path.join(iconOutDir, 'dexter-app-master-1024.png');
  fs.copyFileSync(iconMaster, masterOutPath);
  generated.push(path.relative(repoRoot, masterOutPath));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return generated;
}

function main() {
  ensureMagick();
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${path.relative(repoRoot, inputDir)}`);
  }

  ensureDir(mascotOutDir);
  ensureDir(iconOutDir);

  const files = fs
    .readdirSync(inputDir)
    .filter((file) => file.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  if (files.length === 0) {
    throw new Error(`No PNG files found in ${path.relative(repoRoot, inputDir)}`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    inputDir: path.relative(repoRoot, inputDir),
    mascotOutDir: path.relative(repoRoot, mascotOutDir),
    iconOutDir: path.relative(repoRoot, iconOutDir),
    sources: []
  };

  for (const [index, fileName] of files.entries()) {
    const inputPath = path.join(inputDir, fileName);
    const stem = deriveStem(fileName, index);
    const cleanOutPath = path.join(mascotOutDir, `${stem}.png`);
    const canvasOutPath = path.join(mascotOutDir, `${stem}-canvas-1024.png`);
    cleanBackground(inputPath, cleanOutPath);
    makeCanvasSquare(cleanOutPath, canvasOutPath, 1024);
    const uiVariants = generateUiVariants(canvasOutPath, stem);
    manifest.sources.push({
      sourceFile: fileName,
      stem,
      clean: path.relative(repoRoot, cleanOutPath),
      canvas1024: path.relative(repoRoot, canvasOutPath),
      uiVariants
    });
  }

  const iconSource = manifest.sources.find((item) => item.stem === ICON_SOURCE_STEM) ?? manifest.sources[0];
  const generatedIcons = buildIconSet(path.join(repoRoot, iconSource.clean));
  manifest.iconSet = {
    sourceStem: iconSource.stem,
    files: generatedIcons
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Prepared ${manifest.sources.length} mascot assets and ${manifest.iconSet.files.length} icon files.\n`
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
