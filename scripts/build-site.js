#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

if (existsSync('site')) rmSync('site', { recursive: true, force: true });
mkdirSync('site', { recursive: true });
copyFileSync('index.html', 'site/index.html');
cpSync('src', 'site/src', { recursive: true });
console.log('Built static site in site/');
