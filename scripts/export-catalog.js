#!/usr/bin/env node
import { KERNEL_CATALOG, SCENARIOS } from '../src/core/catalog.js';

console.log(JSON.stringify({ kernels: KERNEL_CATALOG, scenarios: SCENARIOS }, null, 2));
